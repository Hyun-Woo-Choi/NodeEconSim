const express = require('express');
const db = require('../lib/mysql_');

module.exports = function(io) {
  const router = express.Router();

  // 메인 사용자 화면
  router.get('/', async function(req, res, next) {
    try {
      // Redirect if the user is not logged in or is an admin
      if (!req.session.user_id || req.session.user_id === 'admin') {
        return res.redirect('/');
      }

      // Set default language cookie if not already set
      let var_cookie_lang = req.cookies.lang || 'ko';
      if (!req.cookies.lang) {
        res.cookie('lang', 'ko');
      }

      // Fetch user status from the database
      const [[user_info]] = await db.query('SELECT status FROM users WHERE id=?', [req.session.user_id]);
      const var_user_status = user_info.status;

      // Redirect to game if user is in game status (3, 4, or 5)
      if ([3, 4, 5].includes(var_user_status)) {
        return res.redirect('/game');
      }

      // Define user description based on status
      const var_description = var_user_status === 0 ? res.__('not_in_room_description') : res.__('in_room_description');

      // Render the users page
      res.render('users', { 
        cookie_lang: var_cookie_lang,
        user_status: var_user_status,
        description: var_description,
        now_user_id: req.session.user_id
      });
    } catch (error) {
      console.error('Error loading user main page:', error);
      next(error);
    }
  });

  // 한국어 설정
  router.get('/ko', (req, res) => {
    res.cookie('lang', 'ko');
    res.redirect('/users');
  });

  // 영어 설정
  router.get('/en', (req, res) => {
    res.cookie('lang', 'en');
    res.redirect('/users');
  });

  // 로그아웃
  router.get('/signout', async (req, res) => {
    try {
      await new Promise((resolve, reject) => {
        req.session.destroy(err => {
          if (err) reject(err);
          else resolve();
        });
      });
      res.redirect('/');
    } catch (error) {
      console.error('Error during signout:', error);
      res.redirect('/');
    }
  });

  // 사용자 상태 변경
  router.post('/change_status', async (req, res) => {
    try {
      const [[user_info]] = await db.query('SELECT status FROM users WHERE id=?', [req.session.user_id]);

      // Proceed only if the user is not in game
      if (user_info.status === 1 || user_info.status === 2) {
        const now_status = req.body.now_status;

        // Update the user's status
        await db.query('UPDATE users SET status=? WHERE id=?', [now_status, req.session.user_id]);

        // Notify the admin of the user's status change
        io.message(io.user_2_socket_id['admin'], 'change_user_status', {
          user_id: req.session.user_id,
          status: now_status
        });

        res.send('');
      } else {
        res.redirect('/');
      }
    } catch (error) {
      console.error('Error changing user status:', error);
      res.redirect('/');
    }
  });

  return router;
};
