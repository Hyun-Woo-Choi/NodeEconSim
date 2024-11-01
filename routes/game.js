var express = require('express');
const { check, validationResult } = require('express-validator');
var _ = require('lodash');
var db = require('../lib/mysql_');
var game_control = require('../lib/game_control');

module.exports = function(io) {
  var router = express.Router();
  
  router.get('/', async function(req, res, next) {
    try {
      // Redirect if user_id is missing or is admin
      if (!req.session.user_id || req.session.user_id === 'admin') {
        return res.redirect('/');
      }
  
      // Set language and game input status cookies
      const var_cookie_lang = req.cookies.lang || 'ko';
      res.cookie('lang', var_cookie_lang);
      const var_game_input_status = req.cookies.game_input_status || '';
      res.clearCookie('game_input_status');
  
      // Retrieve current user info
      const [[userInfo]] = await db.query('SELECT room, status, wait_other FROM users WHERE id=?', [req.session.user_id]);
      const { room: user_room, status: var_user_status, wait_other: var_is_wait } = userInfo;
  
      // Redirect based on user status
      if ([0, 1, 2].includes(var_user_status)) {
        return res.redirect('/users');
      }
  
      // Retrieve game records for the user and admin
      const [all_game_record] = await db.query("SELECT id, start_time, round, input_one, total_one, price_one, budget, profit FROM game_record WHERE room_id=? AND (id=? OR id='admin') ORDER BY round", [user_room, req.session.user_id]);
      const { user_game_record, now_round, admin_start_time } = processGameRecords(all_game_record);
  
      const remain_time = calculateRemainingTime(admin_start_time);
  
      const {
        game_record_html,
        now_budget,
        community_input,
        budget_limit
      } = generateGameRecordHTML(user_game_record, now_round, var_cookie_lang);
  
      // Retrieve province info and related game states
      const [[{ province_id }]] = await db.query('SELECT province_id FROM game_info WHERE room_id=?', [user_room]);
      const [room_submit_list] = await db.query('SELECT room_submit, room_id FROM game_info WHERE province_id=? AND room_id != ?', [province_id, user_room]);
      const room_submit_html = generateRoomSubmitHTML(room_submit_list);
  
      // Calculate community round
      const community_round = determineCommunityRound(now_round);
  
      // Retrieve energy records for the province and community round
      const [energy_submit_list] = await db.query('SELECT * FROM total_energy_record WHERE province_id = ? AND round = ?', [province_id, community_round]);
      const { total_energy_list, total_energy_div_4_list, total_energy_div_140_list } = processEnergyRecords(energy_submit_list);
  
      // Retrieve other users' status in the room
      const [other_user_list] = await db.query("SELECT wait_other FROM users WHERE room=? AND id!=?", [user_room, req.session.user_id]);
      const other_user_status_html = generateOtherUserStatusHTML(other_user_list, res);
  
      // Retrieve game parameters and type
      const [[game_parameters]] = await db.query('SELECT * FROM game_parameter WHERE room_id=?', [user_room]);
      const [[{ game_type }]] = await db.query('SELECT game_type FROM game_info WHERE room_id=?', [user_room]);
      const production_price = `${res.__('game_user_Cost')}${game_parameters.price_var} - ${res.__('game_user_Num')}`;
  
      // Retrieve previous round budget records
      const prev_round = now_round - 1;
      const [prev_game_record] = await db.query("SELECT budget, input_one FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [prev_round, user_room]);
      const { largest_budget, smallest_budget, mean_value } = calculateBudgetStats(prev_game_record);
  
      // Retrieve community round contributions
      const [community_round_record] = await db.query("SELECT input_one FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [community_round, user_room]);
      const { total_contribution, mean_contribution, usable_electrocity } = calculateCommunityRoundStats(community_round_record);
  
      // Render the game template
      res.render('game', {
        cookie_lang: var_cookie_lang,
        user_status: var_user_status,
        now_user_id: req.session.user_id,
        game_input_status: var_game_input_status,
        is_wait: Number(var_is_wait),
        now_round,
        user_room,
        remain_time,
        other_user_status_html,
        game_record_html,
        budget: now_budget,
        budget_limit,
        smallest_budget,
        largest_budget,
        mean_value_budget: mean_value,
        game_parameters,
        production_price,
        game_type,
        isdisaster_occured: game_parameters.isdisasteroccured,
        total_contribution,
        mean_contribution,
        community_input,
        usable_electrocity,
        total_energy_list,
        room_submit_html,
        budgets: prev_game_record.map(record => record.budget),
        inputs: community_round_record.map(record => record.input_one),
        total_energy_div_4_list,
        total_energy_div_140_list
      });
  
    } catch (error) {
      console.error('Error in game view:', error);
      next(error);
    }
  });
  
  // Helper Functions
  
  function processGameRecords(records) {
    let now_round = 0;
    let admin_start_time;
    const user_game_record = records.filter(record => {
      if (record.id === 'admin') {
        admin_start_time = record.start_time;
        now_round += 1;
        return false;
      }
      return true;
    });
    return { user_game_record, now_round, admin_start_time };
  }
  
  function calculateRemainingTime(admin_start_time) {
    return 120 - Math.floor((Date.now() - admin_start_time) / 1000);
  }
  
  function generateGameRecordHTML(user_game_record, now_round, lang) {
    let game_record_html = '';
    let now_budget = 0;
    let community_input = 0;
    let budget_limit = 0;
  
    const previous_game_record = user_game_record.filter(record => {
      if (record.round >= now_round) return false;
      if (now_round >= 7 && record.round < 7) return false;
      return ![6, 12, 13, 19, 20, 26, 27].includes(record.round);
    });
  
    if (previous_game_record.length > 0) {
      const headers = lang === 'ko' ? ['라운드', '전기 구입량', '그룹 총 구입량', '제품 가격', '예산', '이윤'] : ['Round', 'My Electricity', 'Group Electricity', 'Price', 'Budget', 'Profit'];
      game_record_html += `<div class="table-responsive"><table class="table table-bordered table-sm"><thead class="thead-dark"><tr>`;
      headers.forEach(header => game_record_html += `<th style="text-align: center;">${header}</th>`);
      game_record_html += `</tr></thead><tbody>`;
  
      previous_game_record.forEach(record => {
        game_record_html += `<tr><td style="text-align: center;">${adjustRound(record.round)}</td>`;
        Object.keys(record).forEach(key => {
          if (['id', 'start_time', 'round'].includes(key)) return;
          game_record_html += `<td style="text-align: center;">${record[key]}</td>`;
        });
        game_record_html += `</tr>`;
      });
  
      game_record_html += `</tbody></table></div>`;
      const latest_record = previous_game_record[previous_game_record.length - 1];
      now_budget = latest_record.budget;
      community_input = latest_record.input_one;
      budget_limit = Math.max(now_budget, 0);
    }
    return { game_record_html, now_budget, community_input, budget_limit };
  }
  
  function adjustRound(round) {
    if (round > 12 && round < 19) return round - 8;
    if (round > 19 && round < 26) return round - 10;
    if (round > 5 && round <= 12) return round - 6;
    return round > 26 ? round - 12 : round;
  }
  
  function generateRoomSubmitHTML(room_submit_list) {
    return room_submit_list.map((room, i) => {
      const badge_class = room.room_submit === 1 ? 'badge-success' : 'badge-danger';
      return `<span class="badge ${badge_class}">Group ${i + 1}</span>`;
    }).join(' ');
  }
  
  function determineCommunityRound(now_round) {
    if (now_round > 7 && now_round < 19) return 12;
    if (now_round > 19 && now_round < 26) return 19;
    return now_round > 26 ? 26 : null;
  }
  
  function processEnergyRecords(energy_submit_list) {
    return {
      total_energy_list: energy_submit_list.map(e => e.total_energy),
      total_energy_div_4_list: energy_submit_list.map(e => e.total_energy / 4),
      total_energy_div_140_list: energy_submit_list.map(e => Math.floor(e.total_energy / 140))
    };
  }
  
  function generateOtherUserStatusHTML(other_user_list, res) {
    return other_user_list.map((user, i) => {
      const html_id = `other_user_status_${i + 1}`;
      const badge_class = user.wait_other === 1 ? 'badge-primary' : 'badge-danger';
      const status_text = user.wait_other === 1 ? res.__('other_submit') : res.__('other_wait');
      return `<tr><td>${i + 1}</td><td>Player${i + 1}</td><td><span class="badge ${badge_class}" id="${html_id}">${status_text}</span></td></tr>`;
    }).join('');
  }
  
  function calculateBudgetStats(records) {
    const budgets = records.map(record => record.budget);
    const total = budgets.reduce((sum, budget) => sum + budget, 0);
    return {
      largest_budget: Math.max(...budgets),
      smallest_budget: Math.min(...budgets),
      mean_value: total / budgets.length
    };
  }
  
  function calculateCommunityRoundStats(records) {
    const total_contribution = records.reduce((sum, record) => sum + record.input_one, 0);
    return {
      total_contribution,
      mean_contribution: total_contribution / records.length,
      usable_electrocity: Math.floor(total_contribution / 140)
    };
  }
  
  

  // 한국어 설정
router.get('/ko', function(req, res) {
  res.cookie('lang', 'ko');
  res.redirect('/game');
});

// 영어 설정
router.get('/en', function(req, res) {
  res.cookie('lang', 'en');
  res.redirect('/game');
});

// 로그아웃
router.get('/signout', async function(req, res) {
  try {
    await new Promise((resolve, reject) => {
      req.session.destroy(err => {
        if (err) return reject(err);
        resolve();
      });
    });
    res.redirect('/');
  } catch (error) {
    console.error('Session destruction error:', error);
    res.redirect('/'); // Redirect even if an error occurs
  }
});

router.post('/submit_round', [
  // Validate user input for integer range (0 - 9999999)
  check('input_one').isInt({ min: 0, max: 9999999 }),
  check('input_two').isInt({ min: 0, max: 9999999 })
], async function (req, res, next) {
  try {
    // Check validation result
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // If validation fails, set cookie message and redirect
      res.cookie('game_input_status', res.__('game_int_status'));
      return res.redirect('/game');
    }

    const { input_one, input_two, round: roundString, room_number, budget: budgetString } = req.body;
    const user_id = req.session.user_id;
    const round = Number(roundString);
    const budget = Number(budgetString);

    // Fetch game parameters
    const [[game_params]] = await db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number]);

    // Validate input based on specific round limits
    const is_disaster_occurred = game_params.isdisasteroccured;
    const total_energy = Number(game_params.total_energy);
  
  if (![6, 12, 13, 19, 20, 26, 27].includes(round) && is_disaster_occurred && round > 13 && input_one > Math.floor(total_energy)) { 
      // Restrict input_one to total_energy if a disaster occurred on rounds other than specified disaster rounds
      res.cookie('game_input_status', res.__('game_input_status'));
      return res.redirect('/game');
  } 
  
  else if (![6, 12, 13, 19, 20, 26, 27].includes(round) && input_one > 0 && budget < 0) { 
      // Restrict input_one to budget on non-disaster rounds if budget is greater than 0
      res.cookie('game_input_status', res.__('game_input_status'));
      return res.redirect('/game');
  } 
  
  else if ([6, 12, 19, 26].includes(round) && input_one > budget && budget > 0) { 
      // Restrict input_one to budget on specific contribution rounds if budget is greater than 0
      res.cookie('game_input_status', res.__('game_input_contribution_status'));
      return res.redirect('/game');
  } 
  
  else if ([6, 12, 19, 26].includes(round) && input_two > 20) { 
      // Restrict input_two to a maximum of 20 for specific disaster prediction rounds
      res.cookie('game_input_status', res.__('predicted_input_disaster'));
      return res.redirect('/game');
  } 
  

    // Check for duplicate submission
    const [result] = await db.query('SELECT * FROM game_record WHERE round=? AND id=? AND room_id=?', [round, user_id, room_number]);
    if (result.length > 0) {
      res.cookie('game_input_status', res.__('duplicate_entry'));
      return res.redirect('/game');
    }

    // Record the submission
    await db.query('INSERT INTO game_record (round, id, room_id, start_time, input_one, input_two) VALUES (?, ?, ?, ?, ?, ?)', 
      [round, user_id, room_number, Date.now(), input_one, input_two]);

    // Update user's wait status
    await db.query('UPDATE users SET wait_other=1 WHERE id=?', [user_id]);

    // Notify other users in the same room
    const [user_info] = await db.query('SELECT id FROM users WHERE room=?', [room_number]);
    user_info.forEach(user => {
      if (user.id !== user_id) {
        io.message(io.user_2_socket_id[user.id], 'other_user_submit', '');
      }
    });

    // Check if all users in the room have submitted
    const [user_submit_list] = await db.query("SELECT id FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [round, room_number]);
    if (user_info.length === user_submit_list.length) {
      // For rounds 12, 19, and 26, update state for all rooms in the province
      if ([12, 19, 26].includes(round)) {
        const [[{ province_id }]] = await db.query('SELECT province_id FROM game_info WHERE room_id=?', [room_number]);
        await db.query('UPDATE game_info SET room_submit=1 WHERE room_id=?', [room_number]);

        const [province_rooms] = await db.query('SELECT room_id FROM game_info WHERE province_id=?', [province_id]);

        for (const room of province_rooms) {
          const [province_user_lists] = await db.query('SELECT id FROM users WHERE room=?', [room.room_id]);
          province_user_lists.forEach(user => {
            io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
          });
        }

        const [[{ incomplete }]] = await db.query('SELECT COUNT(*) AS incomplete FROM game_info WHERE province_id=? AND room_submit = 0', [province_id]);
        if (incomplete === 0) {
          // Advance all rooms in the province to the next round
          for (const room of province_rooms) {
            const [user_submit_list] = await db.query("SELECT id FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [round, room.room_id]);
            game_control.cal_round(room.room_id, round, round + 1, user_submit_list, io);
          }
          // Reset room_submit for all rooms in the province
          await db.query('UPDATE game_info SET room_submit=0 WHERE province_id=?', [province_id]);
        }
      } else {
        // For other rounds, proceed directly to the next round
        game_control.cal_round(room_number, round, round + 1, user_submit_list, io);
      }
    }

    res.redirect('/game');
  } catch (error) {
    console.error('Error in submit_round:', error);
    next(error);
  }
});



return router;
};
