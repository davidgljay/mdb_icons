'use strict';

var NounProject = require('the-noun-project'),
https=require('https'),
AWS = require('aws-sdk'),
logger = require('./utils/logger'),
Promise = require('promise');

AWS.config.update({
    accessKeyId: process.env.AWS_KEY, 
    secretAccessKey: process.env.AWS_SECRET, 
    region: process.env.AWS_REGION
});

var dynamodb = new AWS.DynamoDB({apiVersion: '2015-02-02'}),
s3 = new AWS.S3();

var delay = 1500;

//Get tags in need of icons;
var get_tags_promise = new Promise(function(resolve, reject) {
    var needs_tags = [];
    var get_tags = function(startKey) {
        var params = {
            TableName:process.env.TAGS_TABLE,
            FilterExpression: 'attribute_not_exists(icon_attrib)'
        }
        if (startKey) {
            params.ExclusiveStartKey = startKey;
        }
        logger.info("Starting scan");
        dynamodb.scan(params, function(err, result) {
            logger.info("Got scan result");
            if (err) {
                logger.info("Error scanning", err);
                //TODO: Fix. Currently tries again forever.
                setTimeout(function() {
                    get_tags(params.ExclusiveStartKey)
                }, delay);
            } else {
                logger.info(result);
                for (var i = result.Items.length - 1; i >= 0; i--) {
                    needs_tags.push(result.Items[i].tag.S)
                }
                if (result.LastEvaluatedKey) {
                    setTimeout(function() {
                        get_tags(result.LastEvaluatedKey)
                    }, delay);
                } else {
                    resolve(needs_tags);
                }
            }
        })
    }
    get_tags();
})

get_tags_promise.then(getAndPostIcons);


function getAndPostIcons(needs_tags) {
    var promise = needs_tags.reduce(function(lastPromise, tag) {
        logger.info("Getting " + tag);
        return lastPromise.then(getIcon(tag))
                .then(updateS3(tag))
                .then(updateDynamoDB(tag))
        },Promise.resolve())
    return promise;
};

function getIcon (tag) {
    return function(retry) {
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
                        //TODO:Make recursive
                        resolve(getIcon(tag.split(' ')[0])(true));
                    }
                }
                else {
                    resolve(data.icons[0]);
                }
            });
        });
    }
}

function updateS3 (tag) {
    return function(icon) {
        return new Promise(function(resolve,reject) {
            logger.info("Updating s3");
            https.get(icon.preview_url_84, function(res) {
                 var params = {
                    Bucket: 'mayors.buzz',
                    Key: 'images/icons/' + tag.replace(/[^a-z0-9]/ig,"_") + '.png',
                    ACL:'public-read',
                    Body: res
                };
                logger.info("Uploading " + icon.attribution);
                s3.upload(params, function(err, data) {
                    if (err) {reject("Error updating S3:\n" + err);}
                    else {resolve(icon);}
                });
            });
        });
    }   
}

function updateDynamoDB (tag) {
    return function(icon) {
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
                    else {resolve();}
                });
            },delay);
        });        
    }

}
