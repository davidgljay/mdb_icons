var winston = require('winston');
require('winston-papertrail').Papertrail;
if (process.env.ENV=="dev" || process.env.ENV=="prod") {
	var options={
	        host: process.env.PAPERTRAIL_HOST,
	        port: process.env.PAPERTRAIL_PORT
	    };
	var logger = new winston.Logger({
	transports: [
	    new winston.transports.Papertrail(options)
	]
	});
}
else if (process.env.ENV=="test") {
	var logger = new winston.Logger({
	transports: [
	    new winston.transports.Console
	]
	});
}

module.exports=logger;