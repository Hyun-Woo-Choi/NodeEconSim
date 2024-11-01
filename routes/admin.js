var express = require('express');
var bcrypt = require('bcrypt');
const fastcsv = require("fast-csv");
const fs = require("fs");

var db = require('../lib/mysql_');
var game_control = require('../lib/game_control');

module.exports = function(io) {
  var router = express.Router();

  router.get('/', async (req, res) => {
    if (!req.session.user_id || req.session.user_id !== 'admin') {
      return res.redirect('/');
    }

    let cookieLang = req.cookies.lang || 'ko';
    res.cookie('lang', cookieLang);

    const adminStatus = req.cookies.admin_status || '';
    res.clearCookie('admin_status');

    res.render('admin', {
      cookie_lang: cookieLang,
      admin_status: adminStatus,
      start_text: res.__('start'),
      restart_text: res.__('restart')
    });
  });

  router.get('/ko', (req, res) => { // 한국어
    res.cookie('lang', 'ko');
    res.redirect('/admin');
  });
  
  router.get('/en', (req, res) => { // 영어
    res.cookie('lang', 'en');
    res.redirect('/admin');
  });
  
  router.get('/signout', async (req, res) => { // 로그아웃
    try {
      await new Promise((resolve, reject) => {
        req.session.destroy(err => {
          if (err) return reject(err);
          resolve();
        });
      });
      res.redirect('/');
    } catch (err) {
      console.log('Error during logout:', err);
      res.redirect('/');
    }
  });

  router.post('/make_one_id', async function(req, res, next) { // id 생성
    try {
        const input_id = req.body.input_id;
        const input_password = req.body.input_password;

        // ID 중복 확인
        const [info] = await db.query('SELECT id FROM users WHERE id=?', [input_id]);

        if (info.length > 0) { // ID가 이미 존재할 경우
            res.cookie('admin_status', res.__('make_id_fail'));
            return res.redirect('/admin');
        }

        // 비밀번호 해싱
        const hash = await bcrypt.hash(input_password, 10);

        // 새로운 사용자 삽입
        await db.query('INSERT INTO users (id, password) VALUES(?, ?)', [input_id, hash]);
        
        res.cookie('admin_status', res.__('make_id_success'));
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.redirect('/admin');
    }
});

  // 파라미터 불러와서 뿌려줌
  router.post('/patch_parameter', async function(req, res, next) { // 파라미터 불러와서 뿌려줌
    const type_val = req.body.type_val;

    if (type_val === '1' || type_val === '2' || type_val === '3') {
        try {
            // 데이터베이스에서 파라미터 조회
            const [whole_parameter] = await db.query('SELECT * FROM disaster_parameter');

            // 폼의 HTML 생성
            let return_html = '<form method="post" action="/admin/set_parameter">';
            const parameters = Object.values(whole_parameter[0]);
            const input_ids = ["init_w", "adjusted_w", "price_var", "init_budget", "disaster_probability", "disaster_number"];

            for (let i = 0; i < input_ids.length; ++i) {
                return_html += `
                    <div class="form-group row">
                        <label for="${input_ids[i]}" class="col-4 col-form-label">${input_ids[i]}</label>
                        <div class="col-8">
                            <input type="text" class="form-control" id="${input_ids[i]}" name="${input_ids[i]}" value="${parameters[i]}" required="true">
                        </div>
                    </div>`;
            }

            return_html += `<input type="hidden" id="type_val" name="type_val" value="${type_val}">`;
            return_html += '<button type="submit" class="btn btn-primary" style="float: right;">Submit</button>';
            return_html += '</form>';

            // 생성된 HTML을 응답으로 전송
            res.send(return_html);

        } catch (err) {
            console.log('admin', err);
            res.redirect('/admin');
        }
    }
});

  // 파라미터 조정
  router.post('/set_parameter', async function(req, res, next) {
    const post = req.body;
    const type_val = post.type_val;

    if (type_val === '1' || type_val === '2' || type_val === '3') {
        const sql = 'UPDATE disaster_parameter SET init_w=?, adjusted_w=?, price_var=?, init_budget=?, disaster_probability=?, disaster_number=?';
        const params = [post.init_w, post.adjusted_w, post.price_var, post.init_budget, post.disaster_probability, post.disaster_number];

        try {
            // 파라미터 업데이트
            await db.query(sql, params);
            res.cookie('admin_status', res.__('set_parameter_success'));
        } catch (err) {
            console.error('Error updating parameters:', err);
            res.cookie('admin_status', res.__('set_parameter_fail'));
        }
        res.redirect('/admin');
    }
});


router.post('/make_one_room', async function(req, res, next) {
  try {
    const type_val = req.body.type_val;

    // Insert new room type and retrieve last inserted room_id
    const [insertResult] = await db.query('INSERT INTO game_info (game_type) VALUES(?)', [type_val]);

    // Fetch the last inserted room_id
    const [[lastInsertedIdResult]] = await db.query('SELECT LAST_INSERT_ID() as room_id');
    const next_room_id = lastInsertedIdResult.room_id;

    if (!next_room_id) {
      throw new Error('Failed to retrieve room_id.');
    }

    // Retrieve disaster parameters
    const [parametersResult] = await db.query('SELECT * FROM disaster_parameter');
    const parameters = parametersResult[0];

    if (!parameters) {
      throw new Error('Failed to retrieve disaster parameters.');
    }

    // Insert room parameters based on retrieved disaster parameters
    const gameParameterSQL = `
      INSERT INTO game_parameter (room_id, init_w, adjusted_w, price_var, init_budget, disaster_probability, isdisasteroccured,
      first_disaster, second_disaster, total_energy, disaster_number) 
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const gameParameterValues = [
      next_room_id,
      parameters.init_w,
      parameters.adjusted_w,
      parameters.price_var,
      parameters.init_budget,
      parameters.disaster_probability,
      parameters.isdisasteroccured,
      parameters.first_disaster,
      parameters.second_disaster,
      parameters.total_energy,
      parameters.disaster_number
    ];

    await db.query(gameParameterSQL, gameParameterValues);

    // Generate HTML for the new room
    const round_room_id = "round" + next_room_id;
    const wrap_room_id = "wrap_room" + next_room_id;
    const start_room_id = 'start' + next_room_id;
    const stop_room_id = 'stop' + next_room_id;
    const return_html = `
      <div class="col-md-3 mb-3" id=${wrap_room_id}>
        <div class="card text-center">
          <div class="card-header"> Room: ${next_room_id}, Type: ${type_val}, round: <span id=${round_room_id}>1</span> 
            <button type="button" class="delete_room_class close ml-auto" data-id=${next_room_id}>
              <span>x</span>
            </button> 
          </div>
          <div class="card-body" id=${next_room_id}></div>
          <div class="card-footer text-muted">
            <button class="start_room_class btn btn-primary text-white" data-id=${next_room_id} id=${start_room_id}>${res.__('start')}</button>
            <button class="stop_room_class btn btn-primary text-white" data-id=${next_room_id} id=${stop_room_id} disabled>${res.__('stop')}</button>
          </div>
        </div>
      </div>`;

    res.send(return_html);

  } catch (error) {
    console.log('admin', error);
    res.status(500).send('An error occurred while creating the room.');
  }
});

router.post('/assign_province', async function(req, res, next) {
  try {
    // Retrieve all room IDs in ascending order
    const [game_list] = await db.query('SELECT room_id FROM game_info ORDER BY room_id ASC');

    if (game_list.length === 0) {
      return res.status(404).send('No game rooms found');
    }

    let province_id = 1;
    const province_n = 3;

    // Loop through each room and assign province_id
    for (let index = 0; index < game_list.length; index++) {
      const room_id = game_list[index].room_id;

      // Update province_id in both game_info and game_parameter tables
      await db.query('UPDATE game_info SET province_id = ? WHERE room_id = ?', [province_id, room_id]);
      await db.query('UPDATE game_parameter SET province_id = ? WHERE room_id = ?', [province_id, room_id]);

      // Increment province_id every `province_n` rooms
      if ((index + 1) % province_n === 0) {
        province_id++;
      }
    }

    res.send('Provinces assigned successfully to both game_info and game_parameter tables');
  } catch (error) {
    console.log('admin province error', error);
    res.status(500).send('Error assigning provinces');
  }
});


router.post('/make_all_room', async function(req, res, next) {
  try {
    const type_val = req.body.type_val;
    const user_cnt_per_room = 4;

    // Create initial game room to get room_id
    await db.query('INSERT INTO game_info (game_type) VALUES(?)', [type_val]);

    // Get the latest room_id
    const [gameList] = await db.query('SELECT room_id FROM game_info ORDER BY room_id ASC');
    let next_room_id = gameList[gameList.length - 1].room_id;
    const from_room = next_room_id;

    // Retrieve all users
    const [userList] = await db.query('SELECT id, room FROM users');

    // Shuffle the user list
    const shuffledUsers = userList.sort(() => Math.random() - 0.5);

    // Assign users to rooms
    let user_cnt = user_cnt_per_room;
    let local_user_cnt = 0;

    for (let i = 0; i < shuffledUsers.length; i++) {
      const { id: now_user_id, room } = shuffledUsers[i];

      // Skip users already assigned to a room
      if (room !== 0) continue;

      // Update user with the current room assignment
      await db.query('UPDATE users SET room=?, status=? WHERE id=?', [next_room_id, 1, now_user_id]);
      user_cnt--;
      local_user_cnt++;

      // Update game_info's user count for each full room
      if (user_cnt === 0 || i === shuffledUsers.length - 1) {
        await db.query('UPDATE game_info SET user_cnt=? WHERE room_id=?', [local_user_cnt, next_room_id]);
        local_user_cnt = 0;
      }

      // Create a new room when user count reaches 0
      if (user_cnt === 0) {
        await db.query('INSERT INTO game_info (game_type) VALUES(?)', [type_val]);
        user_cnt = user_cnt_per_room;
        next_room_id++;
      }
    }

    // Set room parameters for all rooms
    const to_room = next_room_id;
    const [parametersResult] = await db.query('SELECT * FROM disaster_parameter');
    const parameters = parametersResult[0];

    const game_parameter_sql = `
      INSERT INTO game_parameter (room_id, init_w, adjusted_w, price_var, init_budget, disaster_probability, isdisasteroccured,
      first_disaster, second_disaster, total_energy, disaster_number)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    for (let room = from_room; room <= to_room; room++) {
      const game_parameter_values = [
        room,
        parameters.init_w,
        parameters.adjusted_w,
        parameters.price_var,
        parameters.init_budget,
        parameters.disaster_probability,
        parameters.isdisasteroccured,
        parameters.first_disaster,
        parameters.second_disaster,
        parameters.total_energy,
        parameters.disaster_number
      ];
      await db.query(game_parameter_sql, game_parameter_values);
    }

    res.send('done');
  } catch (error) {
    console.log('admin make all room error', error);
    res.status(500).send('An error occurred while creating rooms and assigning users');
  }
});

  // 새로고침 하면 방을 불러옴
  router.post('/load_game_info', async (req, res) => {
    let var_room_html = "";
  
    try {
      const [game_list] = await db.query('SELECT room_id, province_id, game_type, room_status FROM game_info');
      const [user_list] = await db.query('SELECT id, room, status FROM users');
      const [game_round] = await db.query("SELECT room_id, COUNT(room_id) AS round FROM game_record WHERE id='admin' GROUP BY room_id");
  
      const room_round_cnt = {};
      for (let i = 0; i < game_round.length; ++i) {
        room_round_cnt[game_round[i].room_id] = game_round[i].round;
      }
  
      for (let i = 0; i < game_list.length; ++i) { // Room card generation
        const now_game_info = game_list[i];
        const now_room_status = now_game_info.room_status;
        const wrap_room_id = `wrap_room${now_game_info.room_id}`;
        const round_room_id = `Round${now_game_info.room_id}`;
        const room_province_id = `Province${now_game_info.province_id}`;
        const now_round = room_round_cnt[now_game_info.room_id] || 1;
  
        var_room_html += `
          <div class="col-md-3 mb-3" id=${wrap_room_id}>
            <div class="card text-center">
              <div class="card-header"> Province: ${now_game_info.province_id}, Room: ${now_game_info.room_id}, Type: ${now_game_info.game_type}, Round: <span id=${round_room_id}>${now_round}</span> 
                <button type="button" class="delete_room_class close ml-auto" data-id=${now_game_info.room_id}> <span>x</span> </button> 
              </div>
              <div class="card-body" id=${now_game_info.room_id}>`;
  
        for (let j = 0; j < user_list.length; ++j) { // User status display
          const now_user_info = user_list[j];
          const user_status_id = `status${now_user_info.id}`;
          const temp = now_user_info.status;
          const now_user_status = ['wait', 'ready', 'start', 'stop', 'end'][temp - 1] || '';
  
          if (now_game_info.room_id === now_user_info.room) {
            const selected_user_val_id = `room${now_user_info.id}`;
            var_room_html += `
              <div class="row border-bottom" id=${selected_user_val_id}>
                <b>${now_user_info.id}</b><b class="ml-auto" id=${user_status_id}>${now_user_status}</b>
                <button type="button" class="delete_user_room_class close pl-3" data-id=${now_user_info.id}> <span>-</span> </button>
              </div>`;
          }
        }
  
        const start_room_id = `start${now_game_info.room_id}`;
        const stop_room_id = `stop${now_game_info.room_id}`;
        var_room_html += `
            </div>
            <div class="card-footer text-muted">`;
  
        if (now_room_status === 2) { // Stopped
          var_room_html += `
              <button class="start_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${start_room_id}>${res.__('restart')}</button>
              <button class="stop_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${stop_room_id} disabled>${res.__('stop')}</button>`;
        } else if (now_room_status === 1) { // In progress
          var_room_html += `
              <button class="start_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${start_room_id} disabled>${res.__('restart')}</button>
              <button class="stop_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${stop_room_id}>${res.__('stop')}</button>`;
        } else if (now_room_status === 3) { // Ended
          var_room_html += `
              <button class="start_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${start_room_id} disabled>${res.__('restart')}</button>
              <button class="stop_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${stop_room_id} disabled>${res.__('stop')}</button>`;
        } else if (now_room_status === 0) { // Not started
          var_room_html += `
              <button class="start_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${start_room_id}>${res.__('start')}</button>
              <button class="stop_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${stop_room_id} disabled>${res.__('stop')}</button>`;
        }
  
        var_room_html += `
            </div>
          </div>
        </div>`;
      }
  
      res.send(var_room_html);
    } catch (error) {
      console.log('Error loading game info:', error);
      res.send('fail');
    }
  });
  
  // 오른쪽 사용자 불러옴
router.post('/load_user_info', async (req, res) => {
  let var_user_html = "";

  try {
    const [user_list] = await db.query('SELECT id, room FROM users');

    for (let i = 0; i < user_list.length; ++i) {
      const now_user_info = user_list[i];
      if (now_user_info.room !== 0) continue;

      var_user_html += `
        <div class="row border-bottom" id=${now_user_info.id}>
          <b>${now_user_info.id}</b>
          <button type="button" class="add_user_room_class close ml-auto" data-toggle="modal" data-target="#add_user_room" data-id=${now_user_info.id}> 
            <span>+</span> 
          </button>
        </div>`;
    }

    res.send(var_user_html);
  } catch (err) {
    console.log('Error loading user info:', err);
    res.send('fail');
  }
});


router.post('/load_room_number', async function(req, res, next) {
  try {
    // Retrieve room IDs and user counts from game_info
    const [gameList] = await db.query('SELECT room_id, user_cnt FROM game_info');

    let var_room_number_html = "";

    // Loop through the rooms and add options for rooms with fewer than 4 users
    gameList.forEach((game) => {
      if (game.user_cnt < 4) {
        var_room_number_html += `<option value="${game.room_id}">${game.room_id}</option>`;
      }
    });

    res.send(var_room_number_html);
  } catch (error) {
    console.log('admin load room number error', error);
    res.status(500).send('Error loading room numbers');
  }
});

router.post('/user_2_room', async function(req, res, next) {
  try {
    const room_number_val = req.body.room_number_val;
    const selected_user_val = req.body.selected_user_val;
    const selected_user_val_id = 'room' + selected_user_val;
    const status_id = 'status' + selected_user_val;

    // Get current user count for the specified room
    const [[{ user_cnt: now_user_cnt }]] = await db.query('SELECT user_cnt FROM game_info WHERE room_id=?', [room_number_val]);

    // Check if there's space in the room
    if (now_user_cnt < 4) {
      // Update game_info with the new user count
      await db.query('UPDATE game_info SET user_cnt=? WHERE room_id=?', [now_user_cnt + 1, room_number_val]);

      // Update user record with room and status
      await db.query('UPDATE users SET room=?, status=? WHERE id=?', [room_number_val, 1, selected_user_val]);

      // Generate HTML for the newly added user
      const var_room_user_html = `
        <div class="row border-bottom" id=${selected_user_val_id}>
          <b>${selected_user_val}</b>
          <b class="ml-auto" id=${status_id}>wait</b>
          <button type="button" class="delete_user_room_class close pl-3" data-id=${selected_user_val}>
            <span>-</span>
          </button>
        </div>`;

      // Notify the user of status change
      io.message(io.user_2_socket_id[selected_user_val], 'reload_as_status_change', '');

      // Send HTML back as response
      res.send(var_room_user_html);
    } else {
      res.status(400).send('Room is full');
    }
  } catch (error) {
    console.log('admin user_2_room error', error);
    res.status(500).send('An error occurred while adding the user to the room');
  }
});


router.post('/out_user_room', async function(req, res, next) {
  try {
    const selected_user_val = req.body.selected_user_val;

    // Retrieve the user's current status and room
    const [[userInfo]] = await db.query('SELECT status, room FROM users WHERE id=?', [selected_user_val]);
    const { status, room } = userInfo;

    // Check if the user is in a removable status ('wait' or 'ready')
    if (status === 1 || status === 2) {
      // Proceed with removal process for non-active users
      await removeUserFromRoom(selected_user_val, room);

      // Generate HTML for the user who is now outside any room
      const var_room_user_html = generateUserHtml(selected_user_val);

      // Notify the user about the status change
      io.message(io.user_2_socket_id[selected_user_val], 'reload_as_status_change', '');

      // Send the HTML response back
      res.send(var_room_user_html);

    } else if ([3, 4, 5].includes(status)) {
      // Handle active users: notify them they cannot be removed while in-game
      res.status(400).send('User cannot be removed while actively in a game');
    } else {
      res.status(400).send('User is not in a removable status'); 
    }
  } catch (error) {
    console.log('admin out user error', error);
    res.status(500).send('An error occurred while removing the user from the room');
  }
});

// Helper functions

async function removeUserFromRoom(userId, roomId) {
  // Retrieve the current user count for the room
  const [[{ user_cnt }]] = await db.query('SELECT user_cnt FROM game_info WHERE room_id=?', [roomId]);

  // Remove the user from the room by updating their room and status
  await db.query('UPDATE users SET room=?, status=? WHERE id=?', [0, 0, userId]);

  // Decrement the user count for the room
  await db.query('UPDATE game_info SET user_cnt=? WHERE room_id=?', [user_cnt - 1, roomId]);
}

function generateUserHtml(userId) {
  return `
    <div class="row border-bottom" id=${userId}>
      <b>${userId}</b>
      <button type="button" class="add_user_room_class close ml-auto" data-toggle="modal" data-target="#add_user_room" data-id=${userId}>
        <span>+</span>
      </button>
    </div>`;
}

router.post('/delete_room', async function(req, res, next) {
  try {
    const selected_room_val = req.body.selected_room_val;

    // Check room status before deletion
    const [[{ room_status }]] = await db.query('SELECT room_status FROM game_info WHERE room_id=?', [selected_room_val]);

    // Proceed only if the room is not active (room_status != 1)
    if (room_status !== 1) {
      // Delete the room from game_info
      await db.query('DELETE FROM game_info WHERE room_id=?', [selected_room_val]);

      // Retrieve user IDs in the room to be deleted
      const [usersInRoom] = await db.query('SELECT id, status FROM users WHERE room=?', [selected_room_val]);

      // Reset the game state for all users in this room
      await db.query('UPDATE users SET room=?, status=? WHERE room=?', [0, 0, selected_room_val]);

      // Clear game records if needed
      await db.query('DELETE FROM game_record WHERE room_id=?', [selected_room_val]);

      // Generate HTML for users who were in the deleted room
      let var_room_user_html = '';
      usersInRoom.forEach((user) => {
        const now_id = user.id;
        var_room_user_html += `
          <div class="row border-bottom" id=${now_id}>
            <b>${now_id}</b>
            <button type="button" class="add_user_room_class close ml-auto" data-toggle="modal" data-target="#add_user_room" data-id=${now_id}>
              <span>+</span>
            </button>
          </div>`;

        // Notify active users (status 3, 4, 5) to return to the lobby or another screen
        if ([3, 4, 5].includes(user.status)) {
          io.message(io.user_2_socket_id[now_id], 'room_deleted', { message: 'The room was deleted. Returning to the lobby.' });
        } else {
          io.message(io.user_2_socket_id[now_id], 'reload_as_status_change', '');
        }
      });

      // Send HTML back as response
      res.send(var_room_user_html);
    } else {
      res.status(400).send('Room cannot be deleted while in active status');
    }
  } catch (error) {
    console.log('admin delete room error', error);
    res.status(500).send('An error occurred while deleting the room');
  }
});

router.post('/start_room', async function(req, res, next) {
  try {
    const selected_room_val = req.body.selected_room_val;

    // Retrieve users in the selected room
    const [user_list] = await db.query('SELECT id, status FROM users WHERE room=?', [selected_room_val]);

    // Check if there are fewer than 4 users in the room
    if (user_list.length <= 4) {
      // Check if all users are in "ready" status (status === 2)
      const allReady = user_list.every(user => user.status === 2);

      if (allReady) {
        // Update room status to "active" (room_status=1)
        await db.query('UPDATE game_info SET room_status=1 WHERE room_id=?', [selected_room_val]);

        // Update all users in the room to "in-game" status (status=3)
        await db.query('UPDATE users SET status=3 WHERE room=?', [selected_room_val]);

        // Insert initial game record
        await db.query("INSERT INTO game_record (round, id, room_id, start_time) VALUES(1, 'admin', ?, ?)", [selected_room_val, Date.now()]);

        // Start the room timer and notify users
        game_control.make_room_timer(selected_room_val, 2, io);

        // Notify each user in the room about the status change
        for (const user of user_list) {
          const now_id = user.id;
          io.message(io.user_2_socket_id['admin'], 'change_user_status', {
            user_id: now_id,
            status: '3'
          });
          io.message(io.user_2_socket_id[now_id], 'reload_as_status_change', '');
        }

        res.send('success');
      } else {
        res.status(400).send('All users must be ready to start the game');
      }
    } else {
      res.status(400).send('Room cannot have more than 4 users to start the game');
    }
  } catch (error) {
    console.log('admin start room error', error);
    res.status(500).send('An error occurred while starting the game');
  }
});

  // 게임을 멈춤
  router.post('/stop_room', async function(req, res, next) {
    try {
      const selected_room_val = req.body.selected_room_val;
  
      // Stop the room timer
      game_control.stop_room_timer(selected_room_val);
  
      // Retrieve user list in the room
      const [user_list] = await db.query('SELECT id FROM users WHERE room=?', [selected_room_val]);
  
      // Update user status to indicate the game has been stopped
      await db.query('UPDATE users SET status=4 WHERE room=?', [selected_room_val]);
  
      // Notify each user in the room about the stop action
      user_list.forEach(user => {
        io.message(io.user_2_socket_id[user.id], 'stop_user', res.__('game_stop_explanation'));
      });
  
      // Update the room status to indicate it has been stopped
      await db.query('UPDATE game_info SET room_status=2 WHERE room_id=?', [selected_room_val]);
  
      // Send a success response
      res.send('');
    } catch (error) {
      console.log('Error stopping game:', error);
      res.status(500).send('An error occurred while stopping the game');
    }
  });

  // 재시작
  router.post('/restart_room', async function(req, res, next) {
    try {
      const selected_room_val = req.body.selected_room_val;
  
      // Retrieve user list for the selected room
      const [user_list] = await db.query('SELECT id FROM users WHERE room=?', [selected_room_val]);
  
      // Retrieve the current round for the room
      const [round_info] = await db.query("SELECT round FROM game_record WHERE id='admin' AND room_id=?", [selected_room_val]);
      const cur_round = round_info.length;
  
      // Update the start time for the current round in game_record
      await db.query("UPDATE game_record SET start_time=? WHERE round=? AND id='admin' AND room_id=?", [Date.now(), cur_round, selected_room_val]);
  
      // Update all users in the room to in-game status (status=3)
      await db.query('UPDATE users SET status=3 WHERE room=?', [selected_room_val]);
  
      // Set room status to active
      await db.query('UPDATE game_info SET room_status=1 WHERE room_id=?', [selected_room_val]);
  
      // Check if rounds are within the limit and start the timer
      if (cur_round <= 32) {
        game_control.make_room_timer(selected_room_val, cur_round + 1, io);
      }
  
      // Notify each user in the room about the status change
      for (const user of user_list) {
        const now_id = user.id;
        io.message(io.user_2_socket_id['admin'], 'change_user_status', {
          user_id: now_id,
          status: '3'
        });
        io.message(io.user_2_socket_id[now_id], 'reload_as_status_change', '');
      }
  
      res.send('success');
    } catch (error) {
      console.log('admin restart room error', error);
      res.status(500).send('An error occurred while restarting the room');
    }
  });

// 게임 기록 csv 다운로드
router.post('/download_record', async function(req, res, next) {
  try {
    // Fetch all game records from the database, ordered by room_id, round, and id
    const [result] = await db.query("SELECT * FROM game_record ORDER BY room_id, round, id");

    // Process results and extract admin start times
    const admin_start_time = {};
    const writeData = result
      .filter(record => record.id !== 'admin')  // Exclude admin records from writeData
      .map(record => {
        const admin_key = `${record.round}_${record.room_id}`;
        
        // If the current record is not admin, calculate relative start time
        if (admin_start_time[admin_key]) {
          record.start_time = Math.floor((record.start_time - admin_start_time[admin_key]) / 1000);
        }

        // Process the round information based on conditions
        if (record.round >= 1 && record.round < 6) {
          record.round = 'Practice';
        } else if (record.round === 6) {
          record.round = 'Practice Contribution';
        } else if (record.round > 6 && record.round < 12) {
          record.round -= 6;
        } else if ([12, 19, 26].includes(record.round)) {
          record.round = 'Contribution';
        } else if ([13, 20, 27].includes(record.round)) {
          record.round = 'Satisfaction';
        } else if (record.round > 13 && record.round < 19) {
          record.round -= 10;
        } else if (record.round > 20 && record.round < 26) {
          record.round -= 12;
        }

        return record;
      });

    // Define CSV file name based on current date and time
    const now = new Date();
    const csvFileName = `game_record_${now.getDate()}_${now.getHours()}_${now.getMinutes()}.csv`;
    const csvFilePath = path.join(__dirname, csvFileName);

    // Write data to CSV and pipe to response
    const ws = fs.createWriteStream(csvFilePath);
    fastcsv
      .write(writeData, { headers: true })
      .on("finish", function() {
        console.log("Write to CSV successful!");
        res.download(csvFilePath, csvFileName, (err) => {
          if (err) {
            console.log('CSV download error:', err);
            res.status(500).send('Failed to download CSV');
          }
          fs.unlinkSync(csvFilePath); // Delete the file after download
        });
      })
      .pipe(ws);
  } catch (error) {
    console.log('Game record CSV download error:', error);
    res.status(500).send('An error occurred while generating the CSV');
  }
});
  return router;
}