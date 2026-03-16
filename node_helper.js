const NodeHelper = require("node_helper");
const axios = require("axios");
const { DateTime } = require("luxon");
const { computeParkOpenState } = require("./lib/parkOpenStatus");

module.exports = NodeHelper.create({
  start: function () {
    console.log(`Starting module helper: ${this.name}`);
  },

  getWaitTimes: async function (payload) {
    const moduleConfig = payload && payload.park ? payload : { park: payload };

    const sendError = (msg, entity) => {
      const safeEntity = (entity || moduleConfig?.park?.entity || "unknown").replace(
          / /g,
          "_"
      );
      console.log(`MMM-ThemeParkWaitTimes: ${safeEntity}: ${msg}`);
      this.sendSocketNotification(`ERROR_${safeEntity}`, { errorMessage: msg });
    };

    const parkCfg = moduleConfig?.park || {};
    const selectedPark = {
      entity: parkCfg.entity,
      rides: parkCfg.rides ?? [],
      timezone: parkCfg.timezone ?? null,
      graceBeforeOpenMins: Number(moduleConfig?.graceBeforeOpenMins ?? 0) || 0,
      graceAfterCloseMins: Number(moduleConfig?.graceAfterCloseMins ?? 0) || 0,
    };

    if (!selectedPark.entity) {
      sendError("Missing required config: park.entity", "unknown");
      return;
    }

    const processWaitTimes = async () => {
      console.log(`${selectedPark.entity}: Processing Wait Times...`);
      const waitTimes = await axios.get(
          `https://api.themeparks.wiki/v1/entity/${selectedPark.entity}/live`
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

      results.sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );

      this.sendSocketNotification(`POPULATE_WAIT_TIMES_${selectedPark.entity}`, {
        waitTimes: results,
      });
    };

    const processOpeningTimes = async () => {
      console.log(`${selectedPark.entity}: Processing Opening Times...`);
      const openingTimes = await axios.get(
          `https://api.themeparks.wiki/v1/entity/${selectedPark.entity}/schedule`
      );

      const schedule = openingTimes?.data?.schedule || [];
      if (!Array.isArray(schedule) || schedule.length === 0) {
        this.sendSocketNotification(
            `POPULATE_OPENING_TIMES_${selectedPark.entity}`,
            {
              openingTime: null,
              closingTime: null,
              futureHours: [],
              parkStatus: {
                isOpenNow: false,
                openState: "unknown",
                reason: "no_schedule_data",
                timezone: openingTimes?.data?.timezone ?? selectedPark.timezone,
                nowISO: DateTime.now().toISO(),
                nextOpeningISO: null,
                nextClosingISO: null,
              },
            }
        );
        return;
      }

      const tz = openingTimes?.data?.timezone || selectedPark.timezone || null;

      const parkOpenState = computeParkOpenState({
        schedule,
        timezone: tz,
        graceBeforeOpenMins: selectedPark.graceBeforeOpenMins,
        graceAfterCloseMins: selectedPark.graceAfterCloseMins,
      });

      const displayOpening = parkOpenState.displayOpeningISO
          ? DateTime.fromISO(parkOpenState.displayOpeningISO, { setZone: true })
              .setZone(tz || undefined)
              .toFormat("hh:mm a")
          : null;

      const displayClosing = parkOpenState.displayClosingISO
          ? DateTime.fromISO(parkOpenState.displayClosingISO, { setZone: true })
              .setZone(tz || undefined)
              .toFormat("hh:mm a")
          : null;

      const nowInTz = DateTime.now().setZone(tz || undefined).startOf("day");
      const futureHours = [];
      for (let i = 1; i <= 5; i) {
        const day = nowInTz.plus({ days: i }).toFormat("yyyy-MM-dd");
        const operatingForDay = schedule.filter(
            (s) => s && s.type === "OPERATING" && s.date === day
        );
        if (!operatingForDay.length) {
          futureHours.push("closed");
          continue;
        }
        // ... compute earliest/latest window and format label ...
      }

      this.sendSocketNotification(
          `POPULATE_OPENING_TIMES_${selectedPark.entity}`,
          {
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
          }
      );
    };

    try {
      await processWaitTimes();
    } catch (err) {
      sendError(`Failed to fetch/process live data: ${err.message}`, selectedPark.entity);
    }

    try {
      await processOpeningTimes();
    } catch (err) {
      sendError(`Failed to fetch/process schedule data: ${err.message}`, selectedPark.entity);
    }
  },


  socketNotificationReceived: function (notification, payload) {
    //console.log(notification, "tesT", payload);
    if (notification === "GET_WAIT_TIMES") {
      this.getWaitTimes(payload);
    }
  },
});
