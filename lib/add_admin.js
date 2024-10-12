// add admin
const db = require('./mysql_')
const bcrypt = require('bcrypt');
const saltRounds = 10;
const adminPassword = '2018101225'; // change here

bcrypt.hash(adminPassword, saltRounds, function(err, hash) {
    var sql = 'INSERT INTO users (id, password, room) VALUES(?, ?, ?)';
    var params = ['admin', hash, -1]
    db.query(sql, params, function(err, result) {
        if (err)
            throw(err);
        console.log('done');
        return;
    });
});

