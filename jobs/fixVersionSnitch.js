'use strict';
const utils = require('../utils');

module.exports = {
 name: 'fix version snitch',
 description: 'checks to see if anyone not in QA changes a fix version',
 type: 'time-based',
 dependencies: [
   'slackChannel',
   'jira',
   'mongo'
 ],
 slackChannel: 'test',
 invokeEvery: '5 m',
 fn: async function({
                slackChannel,
                jira,
                mongo
 }) {
   const collection = mongo.collection('sentFixVersionNotifications');
   let fixVersionChangedIds = [];
   let issuesReceived = 0;
   let totalNumIssues;
   const issueSummaries = {};
   const issueChanges = {};
   do {
     await jira.get('search', {
       params : {
         jql: 'project in (BelCAD, Android, iOS) AND issuetype in (Epic, Improvement, Story, "Technical task") AND fixVersion CHANGED DURING (-10m, now() ) AND NOT fixVersion CHANGED DURING (-10m, now() ) BY membersOf(QE)',
         maxResults: 20,
         fields: 'summary',
         startAt: issuesReceived,
         expand: 'changelog'
       }
     }).then(function (response) {
       issuesReceived += response.data.maxResults;
       totalNumIssues = response.data.total;
       fixVersionChangedIds = fixVersionChangedIds.concat(utils.getIssueKeys(response.data.issues));
       response.data.issues.forEach(issue => {
         issueSummaries[issue.key] = issue.fields.summary;
         issueChanges[issue.key] = issue.changelog.histories;
       });
     }).catch(console.log);
   } while (issuesReceived < totalNumIssues);
   getUnwantedChanges(fixVersionChangedIds, collection, issueSummaries, issueChanges).
     then(result => {
       const changes = result.filter(change => {return change !== ''});
       const slackMessage = buildSlackMessage(changes);
       console.log(slackMessage);
       if (slackMessage !== '') {
         slackChannel(slackMessage).then(console.log).catch(console.log);
       }
     }).catch(console.log);
 }
};

function getUnwantedChanges(fixVersionChangedIds, collection, issueSummaries, issueChanges) {
  const promises = [];
  for (const fixVersionChangedId of fixVersionChangedIds) {
    promises.push(getUnwantedChangeInIssue(fixVersionChangedId, collection, issueSummaries[fixVersionChangedId], issueChanges[fixVersionChangedId]));
  };
  return Promise.all(promises);
}

async function getUnwantedChangeInIssue(fixVersionChangedId, collection, summary, changes) {
  for (const change of changes) {
    for (const index in change.items) {
      const currentItem = change.items[index];
      const nextItem = change.items[index + 1];
      if (currentItem.fieldId === "fixVersions"){
        const changeKey = {
          author: change.author.name,
          timestamp: change.created
        };
        const toString = currentItem.toString;
        let fromString = currentItem.fromString;
        if (fromString === null && nextItem) { //I hate that Jira is making me do this, but every fix version change is recorded as a seperate add and remove
          if (nextItem.fieldID === "fixVersions") {
            fromString = nextItem.fromString;
          }
        }
        const mongoResult = await collection.findOne(changeKey);
        if (mongoResult === null) {
          await collection.insertOne(changeKey);
          return {
            author: change.author.name,
            changeString: buildChangeString(fixVersionChangedId,
                                            summary,
                                            item.fromString,
                                            item.toString)
          };
        } else{
          return ''
        };
      }
    };
  };
  return '';
}

function buildChangeString(fixVersionChangedId, summary, fromString, toString) {
  const beginning = utils.createIssueLink(fixVersionChangedId) + ' FIX VERSION ';
  let end;
  if (fromString === null) {
    end = `added ${toString}`;
  } else if (toString === null) {
    end = `removed ~${fromString}~`;
  } else {
    end = `changed ~${fromString}~ --> *${toString}*`;
  }
  end = end + '\n> ' + summary;
  return beginning + end;
}

function buildSlackMessage(changes) {
  console.log('building slack message');
  const consolidatedChanges = {};
  for (const change of changes) {
    const entry = consolidatedChanges[change.author];
    if (entry) {
      entry.push(change.changeString);
    } else {
      consolidatedChanges[change.author] = [ change.changeString ];
    }
  }
  let message = '';
  for (const key in consolidatedChanges) {
    message += `*${key}*\n`;
    for (const item of consolidatedChanges[key]) {
      message += `>${item}\n`;
    }
  }
  return message;
}
