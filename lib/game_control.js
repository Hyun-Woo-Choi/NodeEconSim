var db = require('./mysql_');
var _ = require('lodash');

var game_control = (function () {
    var room_timer = {};

    var make_room_timer = function (room_number, round, io) {
        room_timer[room_number] = setTimeout(function () {
            room_time_out(room_number, round, io);
        }, 122 * 1000); // 120 + 2초, 지연 시간
    };

    var stop_room_timer = function (room_number) {
        clearTimeout(room_timer[room_number]);
    };

    function room_time_out(room_number, round, io) {
        console.log(`room_time_out called for room: ${room_number}, round: ${round}`);
        var user_round = Number(round) - 1; // 관리자보다 사용자가 한 라운드 뒤
        var admin_round = round;
    
        db.query('SELECT id, wait_other FROM users WHERE room=?', [room_number], function (err, user_submit_list) {
            if (err) {
                console.error('room time out error:', err);
                return;
            }
    
            console.log(`User submit list: ${JSON.stringify(user_submit_list)}`);
    
            var users_to_insert = user_submit_list.filter(user => user.wait_other === 0);
            var insert_cnt = users_to_insert.length;
    
            console.log(`Number of users who did not submit: ${insert_cnt}`);
    
            if (insert_cnt === 0) { // 모두 제출했을 때
                console.log(`No users to insert, calling cal_round directly for room: ${room_number}`);
                cal_round(room_number, user_round, admin_round, user_submit_list, io);
            } else {
                var finished = _.after(insert_cnt, function () {
                    console.log(`All inserts finished for room: ${room_number}, calling cal_round`);
                    cal_round(room_number, user_round, admin_round, user_submit_list, io);
                });
    
                users_to_insert.forEach(user => {
                    db.query(
                        'INSERT INTO game_record (round, id, room_id, start_time, input_one, input_two) VALUES(?, ?, ?, ?, 0, 0)',
                        [user_round, user.id, room_number, Date.now()],
                        function (err3) {
                            if (err3) {
                                if (err3.code === 'ER_DUP_ENTRY') { // 중복
                                    console.warn('room insert same time, ignoring 0 insert for room:', room_number);
                                } else {
                                    console.error('during game, user insert error:', err3);
                                }
                            } else {
                                console.log(`Insert finished for user: ${user.id}, calling finished callback`);
                            }
                            finished(); // 콜백을 호출하여 다음 단계로 넘어가도록 함
                        }
                    );
                });
            }
        });
    }
    
    var cal_round = function (room_number, user_round, admin_round, user_submit_list, io) {
        stop_room_timer(room_number); // 타이머 중지
    
        // 관리자에게 라운드 변경 사항 알림
        io.message(io.user_2_socket_id['admin'], 'change_room_round', { 
            round: admin_round,
            room_number: room_number
        });
    
        var user_prev_round = (user_round === 15 || user_round === 22 || user_round == 29) ? user_round - 2 : user_round - 1;
        var community_round;
    
        if (user_round > 13 && user_round < 20) {
            community_round = 13;
        } else if (user_round > 20 && user_round < 27) {
            community_round = 20;
        } else if (user_round > 27) {
            community_round = 27;
        } else if (user_round <= 7) {  // 라운드 7 이하의 라운드 처리
            community_round = 6;  // 초기 라운드로 설정
        }

        // 이전 게임 기록 가져오기
        db.query("SELECT id, price_one, budget FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_prev_round, room_number], function (err4, prev_game_record) {
            if (err4) {
                console.log(err4);
            } else {
                // 현재 게임 기록 가져오기
                db.query("SELECT id, input_one, input_two, round FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_round, room_number], function (err3, record_info) {
                    if (err3) {
                        console.log('cal error', err3);
                    } else {
                        // province_id 가져오기
                        db.query("SELECT province_id FROM game_info WHERE room_id = ?", [room_number], function (err_province_id, province_id) {
                            if (err_province_id) {
                                console.log('province_error', err_province_id);
                            } else {
                                // game_parameter 업데이트
                                db.query("UPDATE game_parameter SET province_id = ? WHERE room_id = ?", [province_id[0].province_id, room_number], function (err_update) {
                                    if (err_update) {
                                        console.log('update error', err_update);
                                    } else {
                                        // game_parameter 가져오기
                                        db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number], function (err, parameters) {
                                            if (err) {
                                                console.log('cal error', err);
                                            } else {
                                                // 라운드별 처리 로직
                                                if (user_round < 6) { // 연습
                                                    processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
                                                } else if (user_round === 6) { // 연습 
                                                    processEnergyContribution(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
                                                } else if (user_round >= 8 && user_round <= 12) {  // 찐 1
                                                    processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
                                                } else if (user_round === 13) { // 재난 라운드 설정
                                                    processEnergyContribution_disaster_choice(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
                                                } else if (user_round === 20 || user_round === 27) { // 찐 2
                                                    processEnergyContribution(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
                                                } else if (user_round === 7 || user_round === 14 || user_round === 21 || user_round === 28) { 
                                                    processNewBudget(record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io);
                                                } else { 
                                                    processDisasterRound(record_info, prev_game_record, parameters, community_round, room_number, user_round, admin_round, user_submit_list, io);
                                                }
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    };

    function processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) {
        var total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
        var price_one = Math.max(0, total_one); // P = sum of input_one, but 0은 넘게 
        var finished = _.after(record_info.length, function () {
            add_admin(admin_round, room_number, user_submit_list, io);
        });

        record_info.forEach((record, index) => {
            var cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one); // profit is : (40 * input_one - total_one * input_one)
            var cur_budget, cur_psum;

            if (user_round == 1 || user_round == 8) { // 이전 데이터 없음 // Practice 뒤 본 게임. 
                cur_budget = Math.max(0, parameters[0].init_budget + cur_round_profit);
                cur_psum = cur_budget - parameters[0].init_budget; // 이름 충돌, 예산 차이
            } else {
                cur_budget = Math.max(0, prev_game_record[index].budget + cur_round_profit);
                cur_psum = cur_budget - prev_game_record[index].budget;
            }
            var cur_id = record.id;

            db.query('UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=? WHERE id=? AND round=? AND room_id=?',
                [total_one, price_one, cur_round_profit, cur_budget, cur_psum, cur_id, user_round, room_number],
                function (err7) {
                    if (err7) {
                        console.log('update param', err7);
                    } else {
                        finished();
                    }
                }
            );
        });
    }

    function processEnergyContribution_disaster_choice(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) {
        // 재난 라운드 배열 설정 (최대 5번의 재난 라운드를 선택할 수 있는 범위)
        if (parameters[0].disaster_number > 5) {
            parameters[0].disaster_number = 5;
        }

        const disaster_rounds = [16, 17, 18, 19, 23, 24, 25, 26, 30, 31, 32, 33];
        const selected_disasters = [];
    
        // 재난 수에 맞게 라운드 선택 (겹치지 않도록 처리)
        for (let i = 0; i < parameters[0].disaster_number; i++) {
            const randomIndex = Math.floor(Math.random() * disaster_rounds.length);
            selected_disasters.push(disaster_rounds[randomIndex]);
            disaster_rounds.splice(randomIndex, 1); // 중복 방지
        }
    
        // 선택된 재난 라운드를 오름차순으로 정렬
        selected_disasters.sort((a, b) => a - b);
    
        // 각 재난 라운드에 해당하는 변수 설정 (디폴트 값 0)
        const [first_round_disaster, second_round_disaster, third_round_disaster, forth_round_disaster, fifth_round_disaster] = selected_disasters;
    
        // 총 에너지 계산
        const sum_energy = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
    
        // sum_energy가 0인 경우 total_energy를 0으로 설정
        const total_energy = sum_energy > 0 ? sum_energy / 128 : 0;
    
        // SQL 쿼리 업데이트 (최대 5개의 재난 라운드)
        db.query('UPDATE game_parameter SET total_energy=?, first_disaster=?, second_disaster=?, third_disaster=?, forth_disaster=?, fifth_disaster=? WHERE room_id=?',
            [total_energy, first_round_disaster || 0, second_round_disaster || 0, third_round_disaster || 0, forth_round_disaster || 0, fifth_round_disaster || 0, room_number],
            function (err) {
                if (err) {
                    console.log('Error updating game_parameter:', err);
                } else {
                    const finished = _.after(record_info.length, function () {
                        add_admin(admin_round, room_number, user_submit_list, io);
                    });
    
                    record_info.forEach((record) => {
                        const contribution_dividends = sum_energy > 0 
                            ? 15 * (sum_energy / 37.5) * (record.input_one / sum_energy)
                            : 0;
    
                        db.query('SELECT game_type, province_id FROM game_info WHERE room_id=?', [room_number], function (err7, user_game_type) {
                            if (err7) {
                                console.log('select contribution game type', err7);
                            } else {
                                const province_id = user_game_type[0].province_id;
    
                                db.query("INSERT INTO total_energy_record (round, province_id, room_id, total_energy) VALUES(?, ?, ?, ?)", 
                                    [user_round, province_id, room_number, sum_energy], function (err2) {
                                    if (err2) {
                                        console.log('Error inserting total_energy_record:', err2);
                                    } else {
                                        const budget_update_fn = function (record, prev_record, adjustment, contribution_dividends) {
                                            db.query('UPDATE game_record SET budget=?, contribution_profit=?, total_one=? WHERE id=? AND round=? AND room_id=?',
                                                [prev_record.budget - adjustment, contribution_dividends, sum_energy, record.id, user_round, room_number],
                                                function (err7) {
                                                    if (err7) {
                                                        console.log('update budget error', err7);
                                                    } else {
                                                        finished();
                                                    }
                                                }
                                            );
                                        };
    
                                        const prev_record = prev_game_record.find(r => r.id === record.id);
                                        if (user_game_type[0].game_type === 1) {
                                            budget_update_fn(record, prev_record, record.input_one, contribution_dividends);
                                        } else if (user_game_type[0].game_type === 2) {
                                            const type_2_community_fund = sum_energy > 0 
                                                ? Math.round(((sum_energy / 4) * 128) / 4)
                                                : 0;
                                            budget_update_fn(record, prev_record, type_2_community_fund, contribution_dividends);
                                        } else {
                                            budget_update_fn(record, prev_record, record.input_one, contribution_dividends);
                                        }
                                    }
                                });
                            }
                        });
                    });
                }
            }
        );
    }

    function processEnergyContribution(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) {

        var sum_energy = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
        
        // sum_energy가 0이면 total_energy는 0, 아니면 정상적으로 나누기 연산
        var total_energy = sum_energy > 0 ? (sum_energy / 35) : 0;
    
        db.query('UPDATE game_parameter SET total_energy=? WHERE room_id=?',
            [total_energy, room_number],
            function (err7) {
                if (err7) {
                    console.log('update contribution', err7);
                } else {
                    var finished = _.after(record_info.length, function () {
                        add_admin(admin_round, room_number, user_submit_list, io);
                    });
    
                    record_info.forEach((record, index) => {
                        // sum_energy가 0이면 contribution_dividends도 0
                        var contribution_dividends = sum_energy > 0 
                            ? 15 * (sum_energy / 37.5) * (record.input_one / sum_energy)
                            : 0;
    
                            db.query('SELECT game_type, province_id FROM game_info WHERE room_id=?', [room_number], function (err7, user_game_type) {
                                if (err7) {
                                    console.log('select contribution game type', err7);
                                } else {
                                    const province_id = user_game_type[0].province_id;
        
                                    db.query("INSERT INTO total_energy_record (round, province_id, room_id, total_energy) VALUES(?, ?, ?, ?)", 
                                        [user_round, province_id, room_number, sum_energy], function (err2) {
                                        if (err2) {
                                            console.log('Error inserting total_energy_record:', err2);
                                        } else {
                                            const budget_update_fn = function (record, prev_record, adjustment, contribution_dividends) {
                                                db.query('UPDATE game_record SET budget=?, contribution_profit=?, total_one=? WHERE id=? AND round=? AND room_id=?',
                                                    [prev_record.budget - adjustment, contribution_dividends, sum_energy, record.id, user_round, room_number],
                                                    function (err7) {
                                                        if (err7) {
                                                            console.log('update budget error', err7);
                                                        } else {
                                                            finished();
                                                        }
                                                    }
                                                );
                                            };
        
                                            const prev_record = prev_game_record.find(r => r.id === record.id);
                                            if (user_game_type[0].game_type === 1) {
                                                budget_update_fn(record, prev_record, record.input_one, contribution_dividends);
                                            } else if (user_game_type[0].game_type === 2) {
                                                const type_2_community_fund = sum_energy > 0 
                                                    ? Math.round(((sum_energy / 4) * 35) / 4) 
                                                    : 0;
                                                budget_update_fn(record, prev_record, type_2_community_fund, contribution_dividends);
                                            } else {
                                                budget_update_fn(record, prev_record, record.input_one, contribution_dividends);
                                            }
                                        }
                                    });
                                }
                            });
                        });
                    }
                }
            );
        }


    function ResetBudget(record_info, parameters, room_number, user_round, admin_round, user_submit_list, io) {
        var finished = _.after(record_info.length, function () {
            add_admin(admin_round, room_number, user_submit_list, io);
        });
    
        record_info.forEach((record, index) => {    
            var cur_budget = Math.max(0, parameters[0].init_budget)
            var cur_id = record.id;

            db.query('UPDATE game_record SET budget=? WHERE id=? AND round=? AND room_id=?',
                [cur_budget, cur_id, user_round, room_number],
                function (err7) {
                    if (err7) {
                        console.log('update budget error', err7);
                    } else {
                        finished();
                    }
                }
            );
        });
    }
    
    function processNewBudget(record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io) {
        var finished = _.after(record_info.length, function () {
            add_admin(admin_round, room_number, user_submit_list, io);
        });

        record_info.forEach((record, index) => {    
            var cur_budget = prev_game_record[index].budget;
            var cur_id = record.id;

            db.query('UPDATE game_record SET budget=? WHERE id=? AND round=? AND room_id=?',
                [cur_budget, cur_id, user_round, room_number],
                function (err7) {
                    if (err7) {
                        console.log('update budget error', err7);
                    } else {
                        finished();
                    }
                }
            );
        });
    }

    function processDisasterRound(record_info, prev_game_record, parameters, community_round, room_number, user_round, admin_round, user_submit_list, io) {
        db.query("SELECT * FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [community_round, room_number], function (err4, community_game_record) {
            if (err4) {
                console.log(err4);
            } else {
                db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number], function (err8, result1) {
                    if (err8) {
                        console.log('disaster error', err8);
                    } else {
                        var disaster_occurence = 
                                (user_round == (result1[0].first_disaster - 1) || 
                                user_round == (result1[0].second_disaster - 1) || 
                                user_round == (result1[0].third_disaster - 1)  || 
                                user_round == (result1[0].forth_disaster - 1) || 
                                user_round == (result1[0].fifth_disaster - 1)) ? 1 : 0;

                        db.query('UPDATE game_parameter SET isdisasteroccured=? WHERE room_id=?', [disaster_occurence, room_number]);

                        if (user_round == (result1[0].first_disaster) || user_round == (result1[0].second_disaster)) {
                            var total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
                            var price_one = Math.max(0, total_one); // P = a - Q
                            var finished = _.after(record_info.length, function () {
                                add_admin(admin_round, room_number, user_submit_list, io);
                            });

                            record_info.forEach((record, index) => {
                                var cur_round_profit;
                                db.query('SELECT game_type FROM game_info WHERE room_id=?', [room_number], function (err7, user_game_type) {
                                    if (err7) {
                                        console.log('select contribution game type', err7);
                                    } else {
                                        if (user_game_type[0].game_type == 3) {
                                            cur_round_profit = (((price_one * record.input_one) - (result1[0].adjusted_w * record.input_one)) + community_game_record.contribution_profit);
                                        } else {
                                            cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one);
                                        }
                                        var cur_budget = Math.max(prev_game_record[index].budget + cur_round_profit);
                                        var cur_psum = cur_budget - prev_game_record[index].budget;
                                        var cur_id = record.id;

                                        db.query('UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=?, isdisasteroccured=? WHERE id=? AND round=? AND room_id=?',
                                            [total_one, price_one, cur_round_profit, cur_budget, cur_psum, 1, cur_id, user_round, room_number],
                                            function (err7) {
                                                if (err7) {
                                                    console.log('update parame', err7);
                                                } else {
                                                    finished();
                                                }
                                            }
                                        );
                                    }
                                });
                            });
                        } else {
                            var total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
                            var price_one = Math.max(0, total_one); // P = a - Q
                            var finished = _.after(record_info.length, function () {
                                add_admin(admin_round, room_number, user_submit_list, io);
                            });

                            record_info.forEach((record, index) => {
                                var cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one);
                                var cur_budget = Math.max(prev_game_record[index].budget + cur_round_profit);
                                var cur_psum = cur_budget - prev_game_record[index].budget;
                                var cur_id = record.id;

                                db.query('UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=? WHERE id=? AND round=? AND room_id=?',
                                    [total_one, price_one, cur_round_profit, cur_budget, cur_psum, cur_id, user_round, room_number],
                                    function (err7) {
                                        if (err7) {
                                            console.log('update parame', err7);
                                        } else {
                                            finished();
                                        }
                                    }
                                );
                            });
                        }
                    }
                });
            }
        });
    }

    function add_admin(admin_round, room_number, user_submit_list, io) {
        db.query("INSERT INTO game_record (round, id, room_id, start_time) VALUES(?, 'admin', ?, ?)", [admin_round, room_number, Date.now()], function (err2) {
            if (err2) {
                if (err2.code === 'ER_DUP_ENTRY') {
                    console.log('ignore duplicate', admin_round);
                } else {
                    console.log('insert admin game error', err2);
                }
            } else {
                // admin_round가 9, 16, 23인 경우에 province_id가 같은 모든 room의 사용자들의 wait_other을 0으로 설정
                if ([9, 16, 23].includes(admin_round)) {
                    db.query('SELECT province_id FROM game_info WHERE room_id=?', [room_number], function(err4, game_info) {
                        if (err4) {
                            console.error('Error getting province_id:', err4);
                        } else {
                            var province_id = game_info[0].province_id;
                            db.query('SELECT room_id FROM game_info WHERE province_id=?', [province_id], function(err5, rooms_in_province) {
                                if (err5) {
                                    console.error('Error getting rooms in province:', err5);
                                } else {
                                    let completedRooms = 0;
                                    const totalRooms = rooms_in_province.length;
    
                                    rooms_in_province.forEach(room => {
                                        db.query('UPDATE users SET wait_other=0 WHERE room=?', [room.room_id], function (err3) {
                                            if (err3) {
                                                console.log('Error updating wait_other for users in room:', room.room_id, err3);
                                            } else {
                                                // 해당 room에 속한 모든 사용자들에게 메시지 전송
                                                db.query('SELECT id FROM users WHERE room=?', [room.room_id], function(err6, users_in_room) {
                                                    if (err6) {
                                                        console.error('Error getting users in room:', room.room_id, err6);
                                                    } else {
                                                        users_in_room.forEach(user => {
                                                            io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
                                                        });
                                                    }
                                                });
                                            }
    
                                            completedRooms++;
                                            if (completedRooms === totalRooms) {
                                                proceedToNextStep(admin_round, room_number, user_submit_list, io);
                                            }
                                        });
                                    });
                                }
                            });
                        }
                    });
                } else {
                    // 일반적인 경우에는 user_submit_list에 있는 사용자들만 wait_other 값을 0으로 설정
                    user_submit_list.forEach(user => {
                        db.query('UPDATE users SET wait_other=0 WHERE id=?', [user.id], function (err3) {
                            if (err3) {
                                console.log('update user wait 0', user.id, err3);
                            } else {
                                io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
                            }
                        });
                    });
                    proceedToNextStep(admin_round, room_number, user_submit_list, io);
                }
            }
        });
    }
    
    function proceedToNextStep(admin_round, room_number, user_submit_list, io) {
        if (admin_round <= 33) { 
            make_room_timer(room_number, admin_round + 1, io);
        } else if (admin_round > 33) { 
            db.query('UPDATE users SET status=5 WHERE room=?', [room_number], function (err2) {
                if (err2) {
                    console.log('end game', err2);
                } else {
                    user_submit_list.forEach(user => {
                        io.message(io.user_2_socket_id['admin'], 'change_user_status', {
                            user_id: user.id,
                            status: '5'
                        });
                    });
                    io.message(io.user_2_socket_id['admin'], 'change_room_round', {
                        round: 'end',
                        room_number: room_number
                    });
                    db.query('UPDATE game_info SET room_status=3 WHERE room_id=?', [room_number], function (err3) {
                        if (err3) {
                            console.error('game end err', err3);
                        }
                    });
                }
            });
        }
    }
    
    return {
        make_room_timer: make_room_timer,
        stop_room_timer: stop_room_timer,
        cal_round: cal_round
    };
}());

module.exports = game_control;
