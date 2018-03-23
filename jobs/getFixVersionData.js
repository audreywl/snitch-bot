'use strict';
const utils = require('../utils');

module.exports = {
  name: 'fix version snitch',
  description: 'adds to db for',
  type: 'responsive',
  hiddenFromHelp: true,
  phrases: [
    'test'
  ],
  dependencies: [
    'jira',
    'mongo'
  ],
  fn: async function({
                 jira,
                 mongo,
                 bot,
                 message
               }) {
    const collection = mongo.collection('fixVersions');
    const jiraQueryResult = await jira.makeJqlQuery({
      jql: 'fixVersion CHANGED DURING (-365d, now())',
      maxResults: 500,
      fields: ['issuetype']
    });
    const fixVersionChangedIds = utils.getIssueKeys(jiraQueryResult.data.issues);
    const unwantedChanges = flatten(await getUnwantedChanges(fixVersionChangedIds, jira));
    // console.log(unwantedChanges);
    await collection.insertMany(unwantedChanges);
    let aggregation = await collection.aggregate([
      {
        $group: {
          _id: {
            'user': '$user',
            'timestamp': '$timestamp'
          },
          dups: {$push:"$_id"},
          count: {$sum: 1}
        }
      },
      {
        $match:
          {
            count: {$gt: 1}
          }
      }
    ]);
    aggregation.forEach(function(doc){
      doc.dups.shift();
      collection.remove({_id : {$in: doc.dups}});
    });
    bot.reply(message, 'done');
  }
};

const qaUserList = [
  'jramsley',
  'jslingerland',
  'mbarr',
  'kathyChang',
  'jsundahl',
  'rbaek',
  'rdharmadhikari',
  'nkania'
];

function flatten(array) {
  return [].concat.apply([], array);
}

function getUnwantedChanges(fixVersionChangedIds, jira) {
  let promises = [];
  for (const fixVersionChangeId of fixVersionChangedIds) {
    promises.push(getUnwantedChangeInIssue(fixVersionChangeId, jira));
  }
  return Promise.all(promises);
}

function getUnwantedChangeInIssue(fixVersionChangedId, jira) {
  return new Promise(function(resolve, reject) {
    let fixVersionChanges = [];
    jira.get(`issue/${fixVersionChangedId}/changelog`).then(response => {
      for (let changeObject of response.data.values) {
        let userIsInQa = qaUserList.includes(changeObject.author.name);
        let toStringPopulated = false;
        for (let change of changeObject.items.reverse()) {
          if (change.fieldId === 'fixVersions') {
           if (!toStringPopulated) {
            fixVersionChanges.push({
              user: changeObject.author.name,
              userIsInQa: userIsInQa,
              timestamp: changeObject.created,
              issueKey: fixVersionChangedId,
              from: change['fromString'],
              to: change['toString']
            });
            toStringPopulated = true;
           } else {
             fixVersionChanges[fixVersionChanges.length - 1].from = change['fromString'];
           }
          }
        }
      }
      resolve(fixVersionChanges);
    }).catch(error=> {
      console.log(error);
      console.log('error searching: ' + fixVersionChangedId);
    });
  });
}