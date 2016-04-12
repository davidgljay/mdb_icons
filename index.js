'use strict';

var NounProject = require('the-noun-project'),
https=require('https'),
AWS = require('aws-sdk'),
Promise = require('promise');

require('./config')

var dynamodb = new AWS.DynamoDB({apiVersion: '2015-02-02'}),
s3 = new AWS.S3();

var handler = exports.handler = function(event, context) {

    var promise_chain = new Promise(function(resolve) {resolve();}),
    i=0;
    //Add promises to get each icon, upload it to S3 and update DynamoDB
    promise_chain = promise_chain.then(getAndPostIcon(event, i));

    promise_chain.then(
        function() {
            context.succeed("Icons added to all tags.")
        },
        function(err) {
            context.fail(err)
        });
};

function getAndPostIcon (event, i) {
    return function() {
        var tag = event.Records[i].dynamodb.Keys.tag.S,
        promise;

        console.log(tag);

        if (event.Records[i].dynamodb.StreamViewType=='OLD_IMAGE') {
            return;
        }

        //Only get a icon if one has not already been added
        if (!event.Records[i].dynamodb.icon_attrib) {
            promise = getIcon(tag)
            .then(function(icon) {
                return updateS3(icon, tag)
                    .then(function() {
                        return updateDynamoDB(icon, tag)
                });
            });
        } else {
            console.log("Skipping " + tag);
            promise = new Promise(function(resolve) {resolve();});
        }

        return promise.then(function() {
            if (i<event.Records.length-1) {
                return getAndPostIcon(event, i+1);
            } else {
                return;
            };
        });
    };
}

function getIcon (tag, retry) {
    return new Promise(function(resolve,reject) {
        var nounproject = new NounProject({
            key: process.env.NOUN_PROJ_KEY,
            secret: process.env.NOUN_PROJ_SECRET
        }).getIconsByTerm(tag, {limit: 1}, function (err, data) {
            if (err) {
                if (retry) {
                    reject("Error Contacting Noun Project: " + err) 
                } else {
                    //If the whole tag is rejected, try just the first word.
                    resolve(getIcon(tag.split(' ')[0], true));
                }
            }
            else {
                resolve(data.icons[0], tag);
            }
        });

    });
}

function updateS3 (icon, tag) {
    return new Promise(function(resolve,reject) {
        console.log(icon);
        https.get(icon.preview_url_84, function(res) {
             var params = {
                Bucket: 'mayors.buzz',
                Key: 'images/icons/' + tag.replace(/[^a-z0-9]/ig,"_") + '.png',
                ACL:'public-read',
                Body: res
            };

            s3.upload(params, function(err, data) {
                if (err) {reject("Error updating S3:\n" + err);}
                else {resolve(data);}
            });
        });
    });
}

function updateDynamoDB (icon, tag) {
    return new Promise(function(resolve, reject) {
        setInterval(function() {
            dynamodb.updateItem({
                TableName:'mayorsdb_tags',
                Key:{tag:{S:tag}},
                ReturnValues:'NONE',
                ReturnItemCollectionMetrics:'NONE',
                ReturnConsumedCapacity: 'NONE',
                ExpressionAttributeValues: {':attrib':{S:icon.attribution}},
                UpdateExpression: 'SET icon_attrib=:attrib'
            },function(err, data) {
                if (err) {reject("Error updating DynamoDB:\n" + err);}
                else {resolve(data);}
            });
        },100);
    });
}
