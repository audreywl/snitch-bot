'use strict';
const calendar_config = require('../creds').calendar;
const calendar_API = require('node-google-calendar');
const moment = require('moment');
const build_calendar = new calendar_API(calendar_config);

module.exports = {
  name: 'branchDay',
  description: 'find out when the next branch day is',
  type: 'responsive',
  dependencies: [
  ],
  hiddenFromHelp: false,
  phrases: [
    'when is branch day?',
    'when is the next branch happening?',
    'branch day'
  ],
  fn: function ({
                  bot,
                  message
                }) {
      const timeMin = moment();
      console.log(timeMin);
      const params = {
        timeMin: timeMin.toISOString(),
        q: 'Branch Day',
        singleEvents: true,
        orderBy: 'startTime'
      };
      build_calendar.Events.list(calendar_config.calendarId.primary, params).then(response => {
        const nextBranch = moment(response[0].start.dateTime);
        bot.reply(message, `The next branch is on ${ nextBranch.format('dddd, MMMM Do [at] h:mm a') }`)
        console.log(json);
      }).catch(err => {
        console.log(err.message);
      });
  }
};
