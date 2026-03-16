const { DateTime } = require("luxon");

function safeDateTimeFromISO(value, timezone) {
    if (!value) return null;

    const parsed = DateTime.fromISO(value, { setZone: true });
    if (!parsed.isValid) return null;

    return timezone ? parsed.setZone(timezone) : parsed;
}

function pickTodayOperatingWindows(schedule, timezone, nowInParkTz) {
    const todayStr = nowInParkTz.toFormat("yyyy-MM-dd");

    return (Array.isArray(schedule) ? schedule : [])
        .filter((entry) => {
            return (
                entry &&
                entry.type === "OPERATING" &&
                entry.date === todayStr &&
                entry.openingTime &&
                entry.closingTime
            );
        })
        .map((entry) => {
            const open = safeDateTimeFromISO(entry.openingTime, timezone);
            const close = safeDateTimeFromISO(entry.closingTime, timezone);

            if (!open || !close || !open.isValid || !close.isValid) {
                return null;
            }

            return {
                openingTime: open,
                closingTime: close
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.openingTime.toMillis() - b.openingTime.toMillis());
}

function pickNextOpening(schedule, timezone, nowInParkTz) {
    const futureWindows = (Array.isArray(schedule) ? schedule : [])
        .filter((entry) => {
            return (
                entry &&
                entry.type === "OPERATING" &&
                entry.openingTime &&
                entry.closingTime
            );
        })
        .map((entry) => {
            const open = safeDateTimeFromISO(entry.openingTime, timezone);
            const close = safeDateTimeFromISO(entry.closingTime, timezone);

            if (!open || !close || !open.isValid || !close.isValid) {
                return null;
            }

            return {
                openingTime: open,
                closingTime: close
            };
        })
        .filter(Boolean)
        .filter((window) => window.openingTime > nowInParkTz)
        .sort((a, b) => a.openingTime.toMillis() - b.openingTime.toMillis());

    return futureWindows.length ? futureWindows[0] : null;
}

function computeParkOpenState({
                                  schedule,
                                  timezone,
                                  now,
                                  graceBeforeOpenMins = 0,
                                  graceAfterCloseMins = 0
                              } = {}) {
    const resolvedTimezone =
        timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "UTC";

    const nowInParkTz = now
        ? DateTime.fromISO(now, { setZone: true }).setZone(resolvedTimezone)
        : DateTime.now().setZone(resolvedTimezone);

    if (!Array.isArray(schedule) || schedule.length === 0) {
        return {
            isOpenNow: false,
            openState: "unknown",
            reason: "no_schedule_data",
            timezone: resolvedTimezone,
            nowISO: nowInParkTz.toISO(),
            nextOpeningISO: null,
            nextClosingISO: null,
            displayOpeningISO: null,
            displayClosingISO: null
        };
    }

    const todayWindows = pickTodayOperatingWindows(
        schedule,
        resolvedTimezone,
        nowInParkTz
    );

    if (!todayWindows.length) {
        const nextOpening = pickNextOpening(schedule, resolvedTimezone, nowInParkTz);

        return {
            isOpenNow: false,
            openState: "closed",
            reason: "no_operating_window_today",
            timezone: resolvedTimezone,
            nowISO: nowInParkTz.toISO(),
            nextOpeningISO: nextOpening ? nextOpening.openingTime.toISO() : null,
            nextClosingISO: nextOpening ? nextOpening.closingTime.toISO() : null,
            displayOpeningISO: null,
            displayClosingISO: null
        };
    }

    for (const window of todayWindows) {
        const effectiveOpen = window.openingTime.minus({
            minutes: graceBeforeOpenMins
        });
        const effectiveClose = window.closingTime.plus({
            minutes: graceAfterCloseMins
        });

        if (nowInParkTz >= effectiveOpen && nowInParkTz <= effectiveClose) {
            return {
                isOpenNow: true,
                openState: "open",
                reason: "within_operating_window",
                timezone: resolvedTimezone,
                nowISO: nowInParkTz.toISO(),
                nextOpeningISO: window.openingTime.toISO(),
                nextClosingISO: window.closingTime.toISO(),
                displayOpeningISO: window.openingTime.toISO(),
                displayClosingISO: window.closingTime.toISO()
            };
        }
    }

    const laterToday = todayWindows.find(
        (window) => nowInParkTz < window.openingTime.minus({ minutes: graceBeforeOpenMins })
    );

    if (laterToday) {
        return {
            isOpenNow: false,
            openState: "closed",
            reason: "before_open_today",
            timezone: resolvedTimezone,
            nowISO: nowInParkTz.toISO(),
            nextOpeningISO: laterToday.openingTime.toISO(),
            nextClosingISO: laterToday.closingTime.toISO(),
            displayOpeningISO: laterToday.openingTime.toISO(),
            displayClosingISO: laterToday.closingTime.toISO()
        };
    }

    const nextOpening = pickNextOpening(schedule, resolvedTimezone, nowInParkTz);
    const lastTodayWindow = todayWindows[todayWindows.length - 1];

    return {
        isOpenNow: false,
        openState: "closed",
        reason: "after_close_today",
        timezone: resolvedTimezone,
        nowISO: nowInParkTz.toISO(),
        nextOpeningISO: nextOpening ? nextOpening.openingTime.toISO() : null,
        nextClosingISO: nextOpening ? nextOpening.closingTime.toISO() : null,
        displayOpeningISO: lastTodayWindow ? lastTodayWindow.openingTime.toISO() : null,
        displayClosingISO: lastTodayWindow ? lastTodayWindow.closingTime.toISO() : null
    };
}

module.exports = { computeParkOpenState };