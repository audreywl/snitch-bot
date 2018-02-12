'use strict';
const utils = require('../utils');

/*
job object should look like:
{
  job name,
  job description,
  slack channel to post to,
  time period for invocation,
  function that takes slack channel and jira object
}
*/
// TODO: double notifications are (will be) annoying
module.exports = {
 name: 'fix version snitch',
 description: 'checks to see if anyone not in QA changes a fix version',
 slackChannel: 'test',
 invokeEvery: '10 seconds',
 fn: function(postSlackMessage, jira) {
   jira.makeJqlQuery({
     jql: 'fixVersion CHANGED DURING (-7d, now())',
     maxResults: 150,
     fields: ['issuetype']
   }).then(result => {
     let fixVersionChangedIssues = result.data.issues;
     let fixVersionChangedIds = [];
     fixVersionChangedIssues.forEach(issue => {
       fixVersionChangedIds.push(issue.key);
     });
     getUnwantedChanges(fixVersionChangedIds, jira).
       then(result => {
         const changes = result.filter(change => {return change !== ''});
         console.log('building slack message');
         let slackMessage = buildSlackMessage(changes);
         console.log(slackMessage);
         if (slackMessage === '') {
           return;
         } else {
           postSlackMessage(slackMessage).
             then(console.log).catch(console.log);
         }
       }).catch(console.log);
   }).catch(console.log);
 }
};

const qaUserList = [
  'jramsley',
  'jslingerland',
  'mbarr',
  'kathyChang',
  'jsundahl',
  'rbaek',
  'rdharmadhikari'
];

function getUnwantedChanges(fixVersionChangedIds, jira) {
  let promises = [];
  for (const fixVersionChangeId of fixVersionChangedIds) {
    promises.push(getUnwantedChangeInIssue(fixVersionChangeId, jira));
  }
  return Promise.all(promises);
}

function getUnwantedChangeInIssue(fixVersionChangedId, jira) {
  return new Promise(function(resolve, reject) {
    jira.get(`issue/${fixVersionChangedId}/changelog`).then(response => {
      // reversing because we want the most recent change
      for (let changeObject of response.data.values.reverse()) {
        if (!qaUserList.includes(changeObject.author.name)) {
          // if the author is not in QA
          for (let change of changeObject.items) {
            if (change.fieldId === 'fixVersions') {
              resolve({
                author: changeObject.author.name,
                changeString: buildChangeString(fixVersionChangedId,
                                                change.fromString,
                                                change.toString)
              });
            }
          }
        }
      }
      resolve('');
    }).catch(error=> {
      resolve({
        author: 'error',
        changeString: 'could not search:' + fixVersionChangedId
      });
    });
  });
}

function buildChangeString(fixVersionChangedId, fromString, toString) {
  const beginning = utils.createIssueLink(fixVersionChangedId);
  let end;
  if (fromString === null) {
    end = `ADDED fix version ${toString}`;
  } else if (toString === null) {
    end = `REMOVED fix version ${fromString}`;
  } else {
    end = `CHANGED from ${fromString} to ${toString}`;
  }
  return beginning + end;
}

function buildSlackMessage(changes) {
  let consolidatedChanges = {};
  for (let change of changes) {
    let entry = consolidatedChanges[change.author];
    console.log(change.author);
    if (entry) {
      entry.push(change.changeString);
    } else {
      consolidatedChanges[change.author] = [change.changeString];
    }
  }
  let message = '';
  for (let key in consolidatedChanges) {
    message += `*${key}*\n`;
    for (let item of consolidatedChanges[key]) {
      message += `>${item}\n`;
    }
  }
  return message;
}
