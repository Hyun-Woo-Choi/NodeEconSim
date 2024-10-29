var express = require('express');
var bcrypt = require('bcrypt');

var db = require('../lib/mysql_')

module.exports = function(io) {
  var router = express.Router();

  router.get('/', function(req, res, next) {
    if (req.session.user_id) { // already sign in
      if (req.session.user_id === 'admin')
        res.redirect('/admin');
      else
        res.redirect('/users');
    }
    else {
      var var_cookie_lang = req.cookies.lang;
      if (var_cookie_lang === undefined) {
        res.cookie('lang', 'en');
        var_cookie_lang = 'en';
      }
      
      // 로그인 실패 여부
      var var_login_status = req.cookies.login_status;
      res.clearCookie('login_status');
      if (var_login_status === undefined)
        var_login_status = '';
        
      res.render('index', { 
        cookie_lang: var_cookie_lang,
        login_status: var_login_status
      });
    }
  });

  router.get('/ko', function(req, res, next) {
    res.cookie('lang', 'ko');
    res.redirect('/');
  });

  router.get('/en', function(req, res, next) {
    res.cookie('lang', 'en');
    res.redirect('/');
  });

  // 로그인
  router.post('/login_process', async (req, res) => {
    const input_id = req.body.input_id;
    const input_password = req.body.input_password;
  
    try {
      const [info] = await db.query('SELECT * FROM users WHERE id = ?', [input_id]);
  
      if (info.length > 0) {
        const isPasswordCorrect = await bcrypt.compare(input_password, info[0].password);
  
        if (isPasswordCorrect) {
          if (input_id in io.user_2_socket_id) { // Prevent duplicate login
            io.message(io.user_2_socket_id[input_id], 'duplicate_login', req.clientIp);
            res.cookie('login_status', res.__('duplicate_login'));
            return res.redirect('/');
          } else { // Successful login
            req.session.user_id = input_id;
            return res.redirect(input_id === 'admin' ? '/admin' : '/users');
          }
        } else { // Incorrect ID or password
          res.cookie('login_status', res.__('login_status'));
          return res.redirect('/');
        }
      } else { // User not found
        res.cookie('login_status', res.__('login_status'));
        return res.redirect('/');
      }
    } catch (err) {
      console.log('Error during login:', err);
      return res.redirect('/');
    }
  });


  // 중복 로그인 - session 삭제
  router.get('/session_destroy_as_duplicate', function(req, res, next) {
    req.session.destroy(function(err) {
      if(err)
        console.log(err);

      res.redirect('/');
    })
  });

  return router;
}