const express = require("express");
const _ = require("lodash");
const async = require("async");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const moment = require("moment-timezone");

const tsf = require("time-slots-finder");
const app = express();

const config = require("./config.json")
const axios = require('axios');
const validator = require('validator');

const ical2json = require('ical2json');

//tz stuff
moment.suppressDeprecationWarnings = true;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

async function fetchCalendar(url) {
  let cal = await axios.get(url).then((res) => {
    if (res.status == 200) {
      return res.data
    }
  }).catch((err) => {
    console.log(err.message);
  })

  return cal
}

function getTZfromICS(ics) {
  const json_cal = ical2json.convert(ics);
    if (Object.keys(json_cal).length === 0) {
        return;
    }
  let tz = json_cal.VCALENDAR[0]['X-WR-TIMEZONE'];
    if (!tz) {
        tz = json_cal.VCALENDAR[0].VTIMEZONE[0].TZID;
}

return tz;

}


function getAvailableSlots(cal, limit, timezone, daysLimit = 7) {

  const ics_timezone = getTZfromICS(cal);

  // set the timezone process wide
  if (!timezone) {
    if (ics_timezone) {
      timezone = ics_timezone;
      // set it globally
      let global = setGlobalTimezone(timezone);
      if (!global) {
        console.log("Error setting global process timezone from the ics file. Defaulting to config timezone.");
        timezone = config.timezone;
      }
    } else {
      timezone = config.timezone;
    }
  }

  const now = moment();
  const then = moment(now).add(daysLimit, "days");


  const avail = [];
  for (let i = 0; i < config.weekdays; i++) {
    avail.push({
      isoWeekDay: i + 1,
      shifts: [{ startTime: config.shiftHours.start, endTime: config.shiftHours.end }],
    });
  }



  const cal_config = {
    timeSlotDuration: config.slotDuration,
    minAvailableTimeBeforeSlot: config.slotInterval,
    minTimeBeforeFirstSlot: 0, // in case you want to add a buffer before the very first slot
    maxDaysBeforeLastSlot: daysLimit,
    availablePeriods: avail,
    timeZone: timezone,
  };

  try {
    tsf.isConfigurationValid(cal_config);
  } catch (err) {
    console.log(err);
  }

  const slots = tsf.getAvailableTimeSlotsInCalendar({
    calendarData: cal,
    calendarFormat: tsf.TimeSlotsFinderCalendarFormat.iCal,
    configuration: cal_config,
    from: now.toDate(),
    to: then.toDate(),
  });

  return slots;

}

// map the slots to a more readable format
function getMomentTimeSlots(respData) {
  const moment_slots = _.map(respData, (slot) => {
    return {
      start: moment(slot.startAt),
      end: moment(slot.endAt),
      duration: slot.duration,
    };
  })
  return moment_slots;
}

function mapTimeSlotsBufferTEST(timeSlots, hourlySlotsLimit = 5) {
  // Group time slots by date
  const timeSlotsByDate = _.groupBy(timeSlots, (slot) =>
    slot.start.format("YYYY-MM-DD")
  );

  // Map each date's time slots to hourly slots from 8am to 6pm on weekdays
  const dateSlots = _.map(timeSlotsByDate, (slots, date) => {
    let _range = config.shiftHours.range
    const hourlySlots = _.range(_range[0], _range[1], 2)
      .map((hour) => {
        const startHour = moment(`${date} ${hour}:00`, "YYYY-MM-DD HH:mm");
        const endHour = moment(`${date} ${hour + 2}:00`, "YYYY-MM-DD HH:mm");
        const bufferStart = startHour.clone().add(config.slotBufferBefore, "minutes");
        const bufferEnd = endHour.clone().subtract(config.slotBufferAfter, "minutes");
        const hourSlots = slots
          .filter(
            (slot) => slot.start >= bufferStart && slot.end <= bufferEnd
          )
          .map((slot) => {
            const startSlot = moment.max(slot.start, bufferStart);
            const endSlot = moment.min(slot.end, bufferEnd);
            const slotDuration = moment.duration(endSlot.diff(startSlot));
            const slotObj = {
              start: startSlot.toString(),
              end: endSlot.toString(),
              duration: `${slotDuration.hours()}h ${slotDuration.minutes()}m`,
            };
            return slotObj;
          });
        // give a name to the slot like 8am-10am etc
        const name = `${startHour.format("ha")}-${endHour.format("ha")}`;
        return {
          block: name,
          start: startHour.toString(),
          end: endHour.toString(),
          bookingSlots: hourSlots,
        };
      })
      .filter((hourSlot) => hourSlot.bookingSlots.length > 0)
      .slice(0, hourlySlotsLimit);

    return {
      date: moment(date).format("DD-MM-YYYY"),
      hourlySlots: hourlySlots,
    };
  });

  // Only return the requested number of hourly slots
  const limitedHourlySlots = _.flatten(
    dateSlots.map((dateSlot) => dateSlot.hourlySlots)
  ).slice(0, hourlySlotsLimit);

  //add date to each slot at # 1
  const limitedHourlySlotsWithDate = limitedHourlySlots.map((slot) => {
    const date = moment(slot.start).format("DD-MM-YYYY");
    return {
      date: date,
      ...slot
    };
  });
  return limitedHourlySlotsWithDate;
}

function validateTimezone(timezone) {
  if (moment.tz.zone(timezone)) {
    return true;
  }
  return false;
}

function setGlobalTimezone(timezone) {
  if (validateTimezone(timezone)) {
    moment.tz.setDefault(timezone);
    return true;
  }
  return false;
}


function validateCalURL(url) {
  const validURL = validator.isURL(url, {
    protocols: ["http", "https"],
    require_protocol: true,
  });
  if (validURL) {
    // check for .ics extension
    const validExtension = url.endsWith(".ics")
    if (validExtension) {
      return true
    }

    return false
  }
}


// app.get("/api/slots", (req, res) => {

//   res.send("App is Listening")

// })

// ENDPOINTS
app.get("/api/slots", (req, res) => {
  let { url, limit, timezone, daysLimit } = req.query;

  // validations
  if (!url) {
    return res.status(400).send({ error: "iCal URL is required" });
  // } else {
  //   const validURL = validateCalURL(url)
  //   if (!validURL) {
  //     return res.status(400).send({ error: "Invalid iCal URL. Please provide a direct link to .ics file" });
  //   }
  }

  if (timezone) {
    let global = setGlobalTimezone(timezone)
    if (!global) {
      return res.status(400).send({ error: "Invalid timezone", timezone: timezone, resource: "https://en.wikipedia.org/wiki/List_of_tz_database_time_zones" });
    }
  }


  // add optional params
  if (!limit) {
    limit = config.defaultSlotLimit;
  }

  if (!daysLimit) {
    daysLimit = config.defaultDaysLimit;
  }

  fetchCalendar(url).then((calendar) => {


    if (!calendar) {
      return res.status(400).send({ error: "Invalid iCal URL. Please provide a direct link to .ics file" });
    }

    async.parallel([
      function (callback) {
        const slots = getAvailableSlots(calendar, limit, timezone, daysLimit)
        const timeSlots = getMomentTimeSlots(slots)
        for (let slot of timeSlots) { }
        const availableSlots = mapTimeSlotsBufferTEST(timeSlots, limit)

        //console.log("availableSlots: ", availableSlots)
        callback(null, availableSlots)

      },

    ], function (err, results) {
      if (err) {
        console.log(err)
      }
      results = results[0]

      return res.send(results);
    })

  });
});

app.get("*", function (request, response) {
  response.status(404).json({ error: "Not found" });
});

const port = process.env.PORT || config.port;
app.listen(port, '0.0.0.0', () => {
  console.log(`Listening on port ${port}`);
})
