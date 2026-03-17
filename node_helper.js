const NodeHelper = require("node_helper");
const axios = require("axios");
const { DateTime } = require("luxon");
const { computeParkOpenState } = require("./lib/parkOpenStatus");

function safeEntityKey(value) {
  return String(value || "unknown").replace(/ /g, "_");
}

function formatTimeRange(openISO, closeISO, tz) {
  if (!openISO || !closeISO) return null;

  const open = DateTime.fromISO(openISO, { setZone: true }).setZone(tz || undefined);
  const close = DateTime.fromISO(closeISO, { setZone: true }).setZone(tz || undefined);

  if (!open.isValid || !close.isValid) return null;

  return `${open.toFormat("hh:mm a")} - ${close.toFormat("hh:mm a")}`;
}

function computeFutureHours(schedule, tz, days = 5) {
  const nowInTz = DateTime.now().setZone(tz || undefined).startOf("day");
  const futureHours = [];

  for (let i = 1; i <= days; i++) {
    const dayStr = nowInTz.plus({ days: i }).toFormat("yyyy-MM-dd");

    const windows = (Array.isArray(schedule) ? schedule : [])
        .filter((s) => s && s.type === "OPERATING" && s.date === dayStr && s.openingTime && s.closingTime)
        .map((s) => ({
          open: DateTime.fromISO(s.openingTime, { setZone: true }).setZone(tz || undefined),
          close: DateTime.fromISO(s.closingTime, { setZone: true }).setZone(tz || undefined),
        }))
        .filter((w) => w.open.isValid && w.close.isValid);

    if (!windows.length) {
      futureHours.push("closed");
      continue;
    }

    windows.sort((a, b) => a.open.toMillis() - b.open.toMillis());
    const earliestOpen = windows[0].open;
    const latestClose = windows.reduce(
        (acc, w) => (w.close.toMillis() > acc.toMillis() ? w.close : acc),
        windows[0].close
    );

    futureHours.push(`${earliestOpen.toFormat("hh:mm a")} - ${latestClose.toFormat("hh:mm a")}`);
  }

  return futureHours;
}

module.exports = NodeHelper.create({
  start: function () {
    console.log(`Starting module helper: ${this.name}`);
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "GET_WAIT_TIMES") {
      this.getWaitTimes(payload);
    }
  },

  getWaitTimes: async function (payload) {
    const moduleConfig = payload && payload.park ? payload : { park: payload };

    const parkCfg = moduleConfig?.park || {};
    const selectedPark = {
      entity: parkCfg.entity,
      rides: parkCfg.rides ?? [],
      timezone: parkCfg.timezone ?? null,
      graceBeforeOpenMins: Number(moduleConfig?.graceBeforeOpenMins ?? 0) || 0,
      graceAfterCloseMins: Number(moduleConfig?.graceAfterCloseMins ?? 0) || 0,
    };

    const entityKey = safeEntityKey(selectedPark.entity);

    const sendError = (msg) => {
      console.log(`MMM-ThemeParkWaitTimes: ${entityKey}: ${msg}`);
      this.sendSocketNotification(`ERROR_${entityKey}`, { errorMessage: msg });
    };

    if (!selectedPark.entity) {
      sendError("Missing required config: park.entity");
      return;
    }

    try {
      console.log(`${selectedPark.entity}: Processing Wait Times...`);
      const waitTimes = await axios.get(
          `https://api.themeparks.wiki/v1/entity/${selectedPark.entity}/live`,
          { timeout: 15000 }
      );

      const results = [];
      for (const ride of waitTimes.data.liveData || []) {
        let showRide = false;

        if (Array.isArray(selectedPark.rides) && selectedPark.rides.length > 0) {
          showRide = selectedPark.rides.includes(ride.id);
        } else {
          showRide = ride.entityType === "ATTRACTION" && ride.queue;
        }

        if (showRide) {
          results.push({
            name: ride.name,
            status: ride?.status || null,
            waitTime: ride?.queue?.STANDBY?.waitTime ?? null,
          });
        }
      }

      results.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

      this.sendSocketNotification(`POPULATE_WAIT_TIMES_${selectedPark.entity}`, {
        waitTimes: results,
      });
    } catch (err) {
      sendError(`Failed to fetch/process live data: ${err.message}`);
    }

    try {
      console.log(`${selectedPark.entity}: Processing Opening Times...`);
      const openingTimes = await axios.get(
          `https://api.themeparks.wiki/v1/entity/${selectedPark.entity}/schedule`,
          { timeout: 15000 }
      );

      const schedule = openingTimes?.data?.schedule || [];
      const tz = openingTimes?.data?.timezone || selectedPark.timezone || null;

      if (!Array.isArray(schedule) || schedule.length === 0) {
        this.sendSocketNotification(`POPULATE_OPENING_TIMES_${selectedPark.entity}`, {
          openingTime: null,
          closingTime: null,
          futureHours: [],
          parkStatus: {
            isOpenNow: false,
            openState: "unknown",
            reason: "no_schedule_data",
            timezone: tz,
            nowISO: DateTime.now().toISO(),
            nextOpeningISO: null,
            nextClosingISO: null,
          },
        });
        return;
      }

      const parkOpenState = computeParkOpenState({
        schedule,
        timezone: tz,
        graceBeforeOpenMins: selectedPark.graceBeforeOpenMins,
        graceAfterCloseMins: selectedPark.graceAfterCloseMins,
      });

      const headerRange = formatTimeRange(parkOpenState.displayOpeningISO, parkOpenState.displayClosingISO, tz);
      const displayOpening = headerRange ? headerRange.split(" - ")[0] : null;
      const displayClosing = headerRange ? headerRange.split(" - ")[1] : null;

      const futureHours = computeFutureHours(schedule, tz, 5);

      this.sendSocketNotification(`POPULATE_OPENING_TIMES_${selectedPark.entity}`, {
        openingTime: displayOpening,
        closingTime: displayClosing,
        futureHours,
        parkStatus: {
          isOpenNow: parkOpenState.isOpenNow,
          openState: parkOpenState.openState,
          reason: parkOpenState.reason,
          timezone: parkOpenState.timezone,
          nowISO: parkOpenState.nowISO,
          nextOpeningISO: parkOpenState.nextOpeningISO,
          nextClosingISO: parkOpenState.nextClosingISO,
        },
      });
    } catch (err) {
      sendError(`Failed to fetch/process schedule data: ${err.message}`);
    }
  },
});

