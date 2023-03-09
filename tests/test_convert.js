const ical2json = require('ical2json');
const fs = require('fs');

const google = fs.readFileSync('./google.ics', 'utf8');


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

console.log('Apple', getTZfromICS(apple));
console.log('Google', getTZfromICS(google));