var mysql = require('mysql');

var connection = mysql.createConnection({
  host     : 'localhost',
  user     : 'root',
  password : '1878', // change here
  database : 'cournot'
});

connection.connect();
module.exports = connection

// SQL DB connection