var express = require('express');

var db = require('../lib/mysql_')

module.exports = function(io) {
  var router = express.Router();

  router.get('/', function(req, res, next) {
    if (req.session.user_id === undefined || req.session.user_id ==='admin')
      res.redirect('/');
    else {
      var var_cookie_lang = req.cookies.lang
      if (var_cookie_lang === undefined) {
        res.cookie('lang', 'ko');
        var_cookie_lang = 'ko';
      }

      db.query('SELECT status FROM users WHERE id=?', [req.session.user_id], function(err, user_info) {
        if (err) {
          console.log(err, req.session.user_id);
        }
        else {
          var var_user_status = user_info[0].status
          if (var_user_status === 3 || var_user_status === 4 || var_user_status === 5) { // during game
            res.redirect('/game');
          }
          else {
            var var_description = var_user_status === 0 ? res.__('not_in_room_description') : res.__('in_room_description');
            res.render('users', { 
              cookie_lang: var_cookie_lang,
              user_status: var_user_status,
              description: var_description,
              now_user_id: req.session.user_id
            });
          }
        }
      });
    }
  });

  router.get('/ko', function(req, res, next) {
    res.cookie('lang', 'ko');
    res.redirect('/users');
  });

  router.get('/en', function(req, res, next) {
    res.cookie('lang', 'en');
    res.redirect('/users');
  });

  router.get('/signout', function(req, res, next) {
    req.session.destroy(function(err) {
      if(err)
        console.log(err);

      res.redirect('/');
    })
  });

  // 사용자가 준비 버튼을 누르면 관리자에게 상태를 보여줌
  router.post('/change_status', function(req, res, next) {
    db.query('SELECT status FROM users WHERE id=?', [req.session.user_id], function(err, result) {
      if (err) {
        console.log(err, req.session.user_id);
        res.redirect('/');
      }
      else {
        if (result[0].status === 1 || result[0].status === 2) { // user not in game
          var now_status = req.body.now_status;
          db.query('UPDATE users SET status=? WHERE id=?', [now_status, req.session.user_id], function(err2, result2) {
            if (err2) {
              console.log(err2, req.session.user_id);
              res.redirect('/');
            }
            else {
              io.message(io.user_2_socket_id['admin'], 'change_user_status', {
                user_id:req.session.user_id,
                status:now_status
              });
              res.send('');
            }
          });
        }
      }
    });
  });
  return router;
}
