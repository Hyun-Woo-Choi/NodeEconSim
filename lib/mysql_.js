var mysql = require('mysql');

var connection = mysql.createConnection({
  host     : '***REMOVED***',
  user     : 'admin',
  password : '***REMOVED***', // change here
  database : 'cournot'
});

connection.connect();
module.exports = connection

// SQL DB connection