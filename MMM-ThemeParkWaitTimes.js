Module.register("MMM-ThemeParkWaitTimes", {
  defaults: {
    updateInterval: 10 * 60 * 1000,
    futureHours: true,

    hideWhenClosed: false,
    graceBeforeOpenMins: 0,
    graceAfterCloseMins: 0,

    visibilityAnimationDuration: 0,
    useVisibilityLock: true,

    hideWhenStatusUnknown: false,

    // Debug/status UI
    showStatusIndicator: true,
    debugShowClosedInsteadOfHide: false, // set true to keep module visible and show "Park closed"
  },

  getScripts: function () {
    return ["moment.js"];
  },

  getStyles: function () {
    return ["style.css"];
  },

  start: function () {
    Log.info("Starting module: " + this.name);

    this.domReady = false;

    this.rides = [];
    this.openingTime = null;
    this.closingTime = null;
    this.futureHours = null;
    this.errorMessage = null;
    this.parkStatus = null;

    this._normalizeConfig();

    setInterval(() => {
      this.processWaitTimes();
    }, this.config.updateInterval);

    this.processWaitTimes();
  },

  _normalizeConfig: function () {
    if (
        this.config.visibilityAnimationDuration == null &&
        this.config.visabilityAnimationDuration != null
    ) {
      this.config.visibilityAnimationDuration = this.config.visabilityAnimationDuration;
    }

    if (this.config.useVisibilityLock == null && this.config.useVisabilityLock != null) {
      this.config.useVisibilityLock = this.config.useVisabilityLock;
    }
  },

  notificationReceived: function (notification) {
    if (notification === "DOM_OBJECTS_CREATED") {
      this.domReady = true;
      this.updateVisibility();
    }
  },

  getHeader: function () {
    const headerDiv = document.createElement("div");
    headerDiv.innerHTML = this.data.header || "";

    const timeSpan = document.createElement("div");
    timeSpan.className = "parkTime";
    if (this.openingTime && this.closingTime) {
      timeSpan.innerHTML = ` ${this.openingTime} - ${this.closingTime}`;
    }
    headerDiv.appendChild(timeSpan);

    if (this.config.futureHours && Array.isArray(this.futureHours) && this.futureHours.length) {
      const hoursTable = document.createElement("table");
      hoursTable.className = "hours";

      const hoursRow = document.createElement("tr");
      hoursTable.appendChild(hoursRow);

      const d = new Date();
      for (let i = 0; i < 5; i++) {
        const hoursCell = document.createElement("td");
        hoursCell.className = "day" + ((d.getDay() + i + 1) % 7);
        hoursCell.innerHTML = this.futureHours[i] ?? "";
        hoursRow.appendChild(hoursCell);
      }

      headerDiv.appendChild(hoursTable);
    }

    return headerDiv.innerHTML;
  },

  _getParkStatusText: function () {
    const status = this.parkStatus;

    if (!status || typeof status.isOpenNow !== "boolean") {
      return "Park status unknown";
    }

    return status.isOpenNow ? "Park open" : "Park closed";
  },

  updateVisibility: function () {
    if (!this.domReady) return;
    if (!this.config.hideWhenClosed) return;

    const status = this.parkStatus;

    if (!status || typeof status.isOpenNow !== "boolean") {
      if (this.config.hideWhenStatusUnknown) this.hideWithLock();
      else this.showWithLock();
      return;
    }

    if (status.isOpenNow) {
      this.showWithLock();
      return;
    }

    if (this.config.debugShowClosedInsteadOfHide) {
      this.showWithLock();
      return;
    }

    this.hideWithLock();
  },

  hideWithLock: function () {
    const speed = this.config.visibilityAnimationDuration || 0;
    if (this.config.useVisibilityLock) this.hide(speed, { lockString: this.identifier });
    else this.hide(speed);
  },

  showWithLock: function () {
    const speed = this.config.visibilityAnimationDuration || 0;
    if (this.config.useVisibilityLock) this.show(speed, { lockString: this.identifier });
    else this.show(speed);
  },

  getDom: function () {
    const wrapper = document.createElement("div");

    if (this.config.showStatusIndicator) {
      const indicator = document.createElement("div");
      indicator.className = "parkStatusIndicator";
      indicator.innerHTML = this._getParkStatusText();
      wrapper.appendChild(indicator);
    }

    const table = document.createElement("table");
    table.className = "small";

    if (this.errorMessage) {
      const row = document.createElement("tr");
      row.className = "row";
      table.appendChild(row);

      const nameCell = document.createElement("td");
      nameCell.className = "error";
      nameCell.innerHTML = this.errorMessage;
      row.appendChild(nameCell);

      wrapper.appendChild(table);
      return wrapper;
    }

    for (let i = 0, ride; (ride = this.rides[i++]); ) {
      const row = document.createElement("tr");
      row.className = "row";
      table.appendChild(row);

      const nameCell = document.createElement("td");
      nameCell.className = "bright title";
      nameCell.innerHTML = ride.name ?? "";
      row.appendChild(nameCell);

      const timeCell = document.createElement("td");
      timeCell.className = "bright title light time";

      const status = ride.status;
      if (status === "CLOSED") timeCell.innerHTML = "closed";
      else if (status === "DOWN") timeCell.innerHTML = "down";
      else if (status === "REFURBISHMENT") timeCell.innerHTML = "refurb";
      else timeCell.innerHTML = ride.waitTime == null ? "—" : String(ride.waitTime);

      row.appendChild(timeCell);
    }

    wrapper.appendChild(table);
    return wrapper;
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "POPULATE_WAIT_TIMES_" + this.config.park.entity) {
      this.rides = payload.waitTimes || [];
      this.updateDom();
      return;
    }

    if (notification === "POPULATE_OPENING_TIMES_" + this.config.park.entity) {
      this.openingTime = payload.openingTime ?? null;
      this.closingTime = payload.closingTime ?? null;
      this.futureHours = payload.futureHours ?? null;
      this.parkStatus = payload.parkStatus ?? null;

      this.updateVisibility();
      this.updateDom();
      return;
    }

    if (notification === "ERROR_" + this.config.park.entity) {
      this.errorMessage = payload.errorMessage || "Unknown error";
      this.updateDom();
    }
  },

  processWaitTimes: function () {
    this.sendSocketNotification("GET_WAIT_TIMES", this.config);
  },
});