var mysql = require('mysql');
require('dotenv').config(); // Load environment variables from .env file

var connection = mysql.createConnection({
  host     : process.env.MYSQL_HOST,
  user     : process.env.MYSQL_USER,
  password : process.env.MYSQL_PASSWORD,
  database : process.env.MYSQL_DATABASE
});

connection.connect();
module.exports = connection;

// SQL DB connection