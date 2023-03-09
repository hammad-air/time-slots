const axios = require('axios');
const moment = require('moment-timezone');
const config = require('./config.json')

moment.tz.setDefault(config.timezone);


const BASE = `http://127.0.0.1:${config.port}/api`

axios.get(`${BASE}/slots`, {
    params: {
        url: 'https://calendar.google.com/calendar/ical/email@gmail.com/public/basic.ics', //fake URL
        limit : 5,
        daysLimit: 7,
}}).then(res => {
    console.log('---'*10)
    for (let slot of res.data){
        console.log(slot)
    }

}).catch(err => {
    console.log(err);
})