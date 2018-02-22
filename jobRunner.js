'use strict';

const every = require('schedule').every;
const fs = require('fs');
const normalizedPath = require("path").join(__dirname, "jobs");
let FuzzySet = require('fuzzyset.js');
let fuzzyMatcher = FuzzySet();
let phraseToJobMap = {};
// TODO: persist this in a better way
let userInfoStore = {};
const userInfoStrings = {
  'githubEmail': 'Github Email',
  'jiraEmail': 'Jira Email'
};

function runJobs(slackBot, dependenciesObj) {
  dependenciesObj.userInfoStore = userInfoStore;
  // getting jobs from the directory
  let jobs = [];
  fs.readdirSync(normalizedPath).forEach(function(file) {
    if (file.endsWith('.js')) {
      jobs.push(require('./jobs/' + file));
    }
  });

  console.log('Loading jobs...');
  let responsiveJobs = [];
  for (let job of jobs) {
    if (job.type === 'time-based') {
      every(job.invokeEvery).do(function () {
        console.log(`invoking ${job.name}`);
        const dependencies = bundleDependencies(dependenciesObj,
                                                job.dependencies,
                                                job.slackChannel);
        job.fn(dependencies);
      });
      console.log(`invoking ${job.name} every ${job.invokeEvery}`);
    } else if (job.type === 'responsive') {
      responsiveJobs.push(job);
    }
  }
  dependenciesObj.responsiveJobs = responsiveJobs;
  setupFuzzyMatcher(responsiveJobs);
  slackBot(listenForSlackMessages(dependenciesObj));
}

function setupFuzzyMatcher(responsiveJobs) {
  for (let job of responsiveJobs) {
    for (let phrase of job.phrases) {
      fuzzyMatcher.add(phrase);
      phraseToJobMap[phrase] = job;
    }
  }
}

function bundleDependencies(dependenciesObj, jobDependencies, optionalSlackChannel) {
  let dependencies = {};
  const slackChannel = 'slackChannel';
  for (let dependencyName of jobDependencies) {
    if (dependencyName === slackChannel) {
      const postSlackMessageFn = dependenciesObj.postSlackMessageFunctions[optionalSlackChannel];
      if (!postSlackMessageFn) {
        console.log('Unknown slack channel, did you spell it correctly?');
      } else {
        dependencies[slackChannel] = postSlackMessageFn
      }
    } else {
      dependencies[dependencyName] = dependenciesObj[dependencyName];
    }
  }
  return dependencies;
}

function listenForSlackMessages(dependenciesObj) {
  return (bot, message) => {
    // find the job this message pertains to
    const job = findJobFromMessage(message);
    // check if it needs identifying info
    let userInfo = {};
    if (job.userInfoNeeded) {
      for (let userInfoNeeded of job.userInfoNeeded) {
        if (!userInfoStore[message.user] || !userInfoStore[message.user][userInfoNeeded]) {
          // if we don't have what we're looking for ask the user to input it.
          bot.reply(message,
            `Sorry, I can't do that without your ${userInfoStrings[userInfoNeeded]}.\n`
            + 'Give it to me by saying something like: '
            + `\`@Amazing-Bot my ${userInfoStrings[userInfoNeeded]} is: example@email.com\``);
        } else {
          userInfo[userInfoNeeded] = dependenciesObj.userInfoStore[userInfoNeeded];
        }
      }
    }
    //bundle dependencies and add bot, message, userInfo
    let dependencies = bundleDependencies(dependenciesObj, job.dependencies);
    dependencies.bot = bot;
    dependencies.message = message;
    dependencies.userInfo = userInfo;
    job.fn(dependencies);
  }
}

function findJobFromMessage(message) {
   const unknownIntent = {
    fn: function ({
                   message,
                   bot
    }) {
      bot.reply(message, 'Sorry, not sure what you want. type `@Amazing-Bot help` for a list of things I can do.');
    },
    dependencies: []
  };
  const match = fuzzyMatcher.get(message.text);
  console.log(match);
  // if we don't have a match or the confidence is extremely low, tell the user we don't know what to do
  if (!match || match[0][0] < 0.33) {
    return unknownIntent;
  } else {
    return phraseToJobMap[match[0][1]];
  }
}

module.exports = {
  runJobs: runJobs
};

