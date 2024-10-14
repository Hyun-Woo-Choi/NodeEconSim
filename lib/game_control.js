var db = require('./mysql_');
var _ = require('lodash');

var game_control = (function () {
    var room_timer = {};

    // 특정 방과 라운드에 대한 타이머를 설정하는 함수. 타이머는 122초(120초 + 2초 지연)
    var make_room_timer = function (room_number, round, io) {
        // 타이머를 설정하고, 'room_timer' 객체에 타이머 참조를 저장
        room_timer[room_number] = setTimeout(function () {
            // 타이머가 끝나면, 'room_time_out' 함수 호출
            room_time_out(room_number, round, io);
        }, 122 * 1000); // 122초(2분 2초) 지연(2초 추가)
    };

    // 특정 방의 타이머를 중지하는 함수
    var stop_room_timer = function (room_number) {
        // 지정된 방의 타임아웃 제거
        clearTimeout(room_timer[room_number]);
    };

    // 타임아웃이 발생한 경우 0을 입력으로 처리하는 함수
    function room_time_out(room_number, round, io) {
        console.log(`room_time_out called for room: ${room_number}, round: ${round}`);
        
        // 사용자의 라운드는 관리자보다 한 라운드 뒤
        var user_round = Number(round) - 1;
        var admin_round = round;
        
        // 해당 방의 사용자들의 ID와 wait_other 값 조회
        db.query('SELECT id, wait_other FROM users WHERE room=?', [room_number], function (err, user_submit_list) {
            if (err) {
                console.error('room time out error:', err);
                return;
            }
        
            console.log(`User submit list: ${JSON.stringify(user_submit_list)}`);
        
            // 제출하지 않은 사용자 필터링
            var users_to_insert = user_submit_list.filter(user => user.wait_other === 0);
            var insert_cnt = users_to_insert.length;
        
            console.log(`Number of users who did not submit: ${insert_cnt}`);
        
            // 제출하지 않은 사용자가 없을 경우, 다음 라운드로 진행
            if (insert_cnt === 0) {
                console.log(`No users to insert, calling cal_round directly for room: ${room_number}`);
                cal_round(room_number, user_round, admin_round, user_submit_list, io);
            } else {
                // 제출하지 않은 사용자들을 0으로 입력 처리
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
                                if (err3.code === 'ER_DUP_ENTRY') {
                                    console.warn('room insert same time, ignoring 0 insert for room:', room_number);
                                } else {
                                    console.error('during game, user insert error:', err3);
                                }
                            } else {
                                console.log(`Insert finished for user: ${user.id}, calling finished callback`);
                            }
                            finished();
                        }
                    );
                });
            }
        });
    }

    // 라운드 처리 함수, 라운드가 끝난 후 호출됨
    var cal_round = function (room_number, user_round, admin_round, user_submit_list, io) {
        stop_room_timer(room_number); // 타이머 중지
    
        // 관리자에게 라운드 변경 알림
        io.message(io.user_2_socket_id['admin'], 'change_room_round', { 
            round: admin_round,
            room_number: room_number
        });

        // 이전 라운드 계산
        var user_prev_round = (user_round === 14 || user_round === 21 || user_round == 28) ? user_round - 2 : user_round - 1;

        var community_round;
 
        // 라운드별 커뮤니티 라운드 설정 
        if (user_round > 7 && user_round < 19) {
            community_round = 12; 
        } else if (user_round > 19 && user_round < 26) {
            community_round = 19; 
        } else if (user_round > 26) {
            community_round = 26; 
        }


        // 이전 게임 기록 조회
        db.query("SELECT id, price_one, budget FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_prev_round, room_number], function (err4, prev_game_record) {
            if (err4) {
                console.log(err4);
            } else {
                // 현재 게임 기록 조회
                db.query("SELECT id, input_one, input_two, round FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_round, room_number], function (err3, record_info) {
                    if (err3) {
                        console.log('cal error', err3);
                    } else {
                        // province_id 조회 (province_id가 같은 그룹을 고르기 위해)
                        db.query("SELECT province_id FROM game_info WHERE room_id = ?", [room_number], function (err_province_id, province_id) {
                            if (err_province_id) {
                                console.log('province_error', err_province_id);
                            } else {
                                // game_parameter 업데이트 (province_id game_parameter에 input)
                                db.query("UPDATE game_parameter SET province_id = ? WHERE room_id = ?", [province_id[0].province_id, room_number], function (err_update) {
                                    if (err_update) {
                                        console.log('update error', err_update);
                                    } else {
                                        // 라운드 처리 로직, 라운드 하나씩 당김 
                                        if (user_round < 6) { // 연습(본 게임에 앞서 연습게임을 실행)
                                            processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
                                        } else if (user_round === 6) { // 연습(본 게임에 앞서 연습게임을 실행), ESS 기여금
                                            processEnergyContribution(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
                                        } else if (user_round >= 7 && user_round <= 11) {  // 본게임, 전기 생산 
                                            processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
                                        } else if (user_round === 12) { // 재난 라운드 설정 및 ESS 기여금 
                                            processEnergyContribution_disaster_choice(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
                                        } else if (user_round === 19 || user_round === 26) { // ESS 기여금  
                                            processEnergyContribution(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
                                        } else if (user_round === 13 || user_round === 20 || user_round === 27) {  // 공동체 만족도 조사, 그냥 budget만 내려오면 됨.
                                            processNewBudget(record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io);
                                        } else { // 전기 구입 with disaster_risk
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
    };

    function processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) { 
        // 각 사용자의 input_one 값을 모두 더해 total_one 계산
        var total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
        // price_one은 total_one에서 최소값 0으로 설정 (0보다 작을 수 없도록 설정)
        var price_one = Math.max(0, total_one); // P = sum of input_one, 0은 넘을 수 없음
        
        // 모든 기록 처리가 끝난 후 호출되는 콜백 함수 (finished가 모든 작업이 완료되면 실행됨)
        var finished = _.after(record_info.length, function () {
            add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
        });
    
        // record_info 배열의 각 사용자에 대해 게임 기록 업데이트
        record_info.forEach((record, index) => {
            // profit은 (가격 변수 * input_one) - (price_one * input_one)으로 계산
            var cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one);
            var cur_budget, cur_psum;
    
            // 만약 user_round가 1 또는 8일 경우 이전 데이터가 없으므로 초기 예산에서 계산
            if (user_round == 1 || user_round == 8) { 
                cur_budget = parameters[0].init_budget + cur_round_profit; // 초기 예산에서 이익을 더해 예산 계산, 0보다 작을 수도 있음. 
                cur_psum = cur_budget - parameters[0].init_budget; // 초기 예산과 현재 예산의 차이 계산
            } else {
                // 이전 라운드의 예산과 현재 라운드의 이익을 더해 새로운 예산 계산
                cur_budget = prev_game_record[index].budget + cur_round_profit;
                cur_psum = cur_budget - prev_game_record[index].budget; // 예산 차이 계산
            }

            var cur_id = record.id; // 현재 사용자 ID
    
            // game_record 테이블에서 해당 사용자의 기록을 업데이트 (total_one, price_one, 이익, 예산, 차이)
            db.query('UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=? WHERE id=? AND round=? AND room_id=?',
                [total_one, price_one, cur_round_profit, cur_budget, cur_psum, cur_id, user_round, room_number],
                function (err7) { 
                    if (err7) {
                        console.log('update param', err7); // 오류 발생 시 로그 출력
                    } else {
                        finished(); // 각 업데이트가 완료될 때마다 finished 호출
                    }
                }
            );
        });
    }
    

    function processEnergyContribution_disaster_choice(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) { // 재난 라운드 선택 + 게임 모드에 따른 기여금 설정. 
        // 재난 라운드의 최대 개수를 5로 제한 (최대 5번의 재난 라운드를 선택)
        if (parameters[0].disaster_number > 5) {
            parameters[0].disaster_number = 5;
        }
    
        // 재난 라운드로 선택될 수 있는 라운드 목록 (15, 16, 17, 18, 22, 23, 24, 25, 29, 30, 31, 32)
        const disaster_rounds = [15, 16, 17, 18, 22, 23, 24, 25, 29, 30, 31, 32];
        const selected_disasters = []; // 선택된 재난 라운드를 저장할 배열
        
        // 재난 수에 맞게 재난 라운드를 선택 (겹치지 않도록 처리)
        for (let i = 0; i < parameters[0].disaster_number; i++) {
            // disaster_rounds에서 무작위로 라운드 하나를 선택
            const randomIndex = Math.floor(Math.random() * disaster_rounds.length);
            selected_disasters.push(disaster_rounds[randomIndex]); // 선택된 라운드를 추가
            disaster_rounds.splice(randomIndex, 1); // 중복 선택 방지를 위해 해당 라운드를 배열에서 제거
        }
    
        // 선택된 재난 라운드를 오름차순으로 정렬
        selected_disasters.sort((a, b) => a - b);
        
        // 선택된 재난 라운드를 각 변수에 할당 (최대 5개)
        const [first_round_disaster, second_round_disaster, third_round_disaster, forth_round_disaster, fifth_round_disaster] = selected_disasters;
    
        // 총 에너지를 계산 (각 사용자의 input_one 값을 모두 더함)
        const sum_energy = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
        
        // sum_energy가 0인 경우 total_energy는 0, 그렇지 않으면 128로 나눈 값
        const total_energy = sum_energy > 0 ? sum_energy / 128 : 0;
    
        // 게임 파라미터를 업데이트 (선택된 재난 라운드와 총 에너지)
        db.query('UPDATE game_parameter SET total_energy=?, first_disaster=?, second_disaster=?, third_disaster=?, forth_disaster=?, fifth_disaster=? WHERE room_id=?',
            [total_energy, first_round_disaster || 0, second_round_disaster || 0, third_round_disaster || 0, forth_round_disaster || 0, fifth_round_disaster || 0, room_number],
            function (err) {
                if (err) {
                    console.log('Error updating game_parameter:', err); // 오류 발생 시 로그 출력
                } else {
                    // 모든 작업이 완료되면 호출될 finished 콜백 설정
                    const finished = _.after(record_info.length, function () {
                        add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
                    });
    
                    // 각 사용자에 대한 기록을 업데이트
                    record_info.forEach((record) => {
                        // 에너지가 0보다 크면 기여 배당금 계산, 그렇지 않으면 0
                        const contribution_dividends = sum_energy > 0 
                            ? 15 * (sum_energy / 37.5) * (record.input_one / sum_energy)
                            : 0;
    
                        // 게임 정보에서 game_type과 province_id를 가져옴
                        db.query('SELECT game_type, province_id FROM game_info WHERE room_id=?', [room_number], function (err7, user_game_type) {
                            if (err7) {
                                console.log('select contribution game type', err7); // 오류 발생 시 로그 출력
                            } else {
                                const province_id = user_game_type[0].province_id;
    
                                // 총 에너지 기록을 total_energy_record 테이블에 삽입
                                db.query("INSERT INTO total_energy_record (round, province_id, room_id, total_energy) VALUES(?, ?, ?, ?)", 
                                    [user_round, province_id, room_number, sum_energy], function (err2) {
                                    if (err2) {
                                        console.log('Error inserting total_energy_record:', err2); // 에너지 기록 삽입 시 오류 발생
                                    } else {
                                        // 예산 업데이트 함수 정의
                                        const budget_update_fn = function (record, prev_record, adjustment, contribution_dividends) {
                                            // 게임 기록을 업데이트 (예산, 기여 이익, 총 에너지)
                                            db.query('UPDATE game_record SET budget=?, contribution_profit=?, total_one=? WHERE id=? AND round=? AND room_id=?',
                                                [prev_record.budget - adjustment, contribution_dividends, sum_energy, record.id, user_round, room_number],
                                                function (err7) {
                                                    if (err7) {
                                                        console.log('update budget error', err7); // 예산 업데이트 시 오류 발생
                                                    } else {
                                                        finished(); // 모든 업데이트가 완료되면 finished 콜백 호출
                                                    }
                                                }
                                            );
                                        };
    
                                        // 이전 라운드 기록에서 현재 사용자의 기록을 찾음
                                        const prev_record = prev_game_record.find(r => r.id === record.id);
                                        if (user_game_type[0].game_type === 1) {
                                            // game_type이 1인 경우, input_one을 기반으로 예산 업데이트
                                            budget_update_fn(record, prev_record, record.input_one, contribution_dividends);
                                        } else if (user_game_type[0].game_type === 2) {
                                            // game_type이 2인 경우, 커뮤니티 펀드 기반으로 예산 업데이트
                                            const type_2_community_fund = sum_energy > 0 
                                                ? Math.round(((sum_energy / 4) * 128) / 4)
                                                : 0;
                                            budget_update_fn(record, prev_record, type_2_community_fund, contribution_dividends);
                                        } else {
                                            // 다른 game_type의 경우, input_one을 기반으로 예산 업데이트
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

    function processEnergyContribution(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) { // 위 함수와 동일, but 재난 선택 로직은 없음.

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


    function ResetBudget(record_info, parameters, room_number, user_round, admin_round, user_submit_list, io) { // budget reset 하는 로직인데, 프로그램에는 포함 안됨. 
        var finished = _.after(record_info.length, function () {
            add_admin(admin_round, room_number, user_submit_list, io);
        });
    
        record_info.forEach((record, index) => {    
            var cur_budget = parameters[0].init_budget
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
    
    function processNewBudget(record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io) { // 그냥 이전 예산을 가져오는 로직
        // 모든 작업이 완료된 후 호출될 콜백 함수 설정
        var finished = _.after(record_info.length, function () {
            add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
        });
    
        // 각 사용자의 기록을 순회하며 예산을 업데이트
        record_info.forEach((record, index) => {    
            // 이전 라운드의 예산을 가져옴 (prev_game_record에서 budget 값 사용)
            var cur_budget = prev_game_record[index].budget;
            var cur_id = record.id; // 현재 사용자의 ID
    
            // game_record 테이블에서 해당 사용자의 예산(budget)을 업데이트
            db.query('UPDATE game_record SET budget=? WHERE id=? AND round=? AND room_id=?',
                [cur_budget, cur_id, user_round, room_number],
                function (err7) {
                    if (err7) {
                        console.log('update budget error', err7); // 예산 업데이트 중 오류 발생 시 로그 출력
                    } else {
                        finished(); // 각 업데이트가 완료될 때마다 finished 호출
                    }
                }
            );
        });
    }

    function processDisasterRound(record_info, prev_game_record, parameters, community_round, room_number, user_round, admin_round, user_submit_list, io) { // 일반 게임 with disaster probability
        // 커뮤니티 라운드에 해당하는 게임 기록 조회 (관리자는 제외)
        db.query("SELECT * FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [community_round, room_number], function (err4, community_game_record) {
            if (err4) {
                console.log(err4); // 오류 발생 시 로그 출력
            } else {
                // 현재 방의 game_parameter 정보 조회
                db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number], function (err8, result1) {
                    if (err8) {
                        console.log('disaster error', err8); // 오류 발생 시 로그 출력
                    } else {
                        // 다음 라운드가 재난 발생 라운드인지 확인 (맞다면 disaster_occurence를 1로 설정)
                        var disaster_occurence = 
                            (user_round == (result1[0].first_disaster - 1) || 
                            user_round == (result1[0].second_disaster - 1) || 
                            user_round == (result1[0].third_disaster - 1)  || 
                            user_round == (result1[0].forth_disaster - 1) || 
                            user_round == (result1[0].fifth_disaster - 1)) ? 1 : 0;
    
                        // 재난 발생 여부를 game_parameter 테이블에 업데이트
                        db.query('UPDATE game_parameter SET isdisasteroccured=? WHERE room_id=?', [disaster_occurence, room_number]);
    
                        // 재난이 발생한 첫 번째 또는 두 번째 재난 라운드일 경우
                        if (
                            user_round == result1[0].first_disaster ||
                            user_round == result1[0].second_disaster ||
                            user_round == result1[0].third_disaster ||
                            user_round == result1[0].forth_disaster ||
                            user_round == result1[0].fifth_disaster
                        ) {
                            // 모든 사용자에 대한 총 input_one 값을 합산
                            var total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
                            var price_one = Math.max(0, total_one); // 총 에너지는 음수가 될 수 없으므로 최소 0
                            var finished = _.after(record_info.length, function () {
                                add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
                            });
    
                            // 각 사용자의 게임 기록 업데이트
                            record_info.forEach((record, index) => {
                                var cur_round_profit;
                                // game_info 테이블에서 현재 방의 game_type을 조회
                                db.query('SELECT game_type FROM game_info WHERE room_id=?', [room_number], function (err7, user_game_type) {
                                    if (err7) {
                                        console.log('select contribution game type', err7); // 오류 발생 시 로그 출력
                                    } else {
                                        // game_type이 3인 경우, 재난 기여를 고려한 수익 계산
                                        if (user_game_type[0].game_type == 3) {
                                            cur_round_profit = (((price_one * record.input_one) - (result1[0].adjusted_w * record.input_one)) + community_game_record.contribution_profit);
                                        } else {
                                            // 일반적인 수익 계산 (가격 변동 * input_one)
                                            cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one);
                                        }
                                        // 현재 라운드 예산 계산 (이전 예산 + 수익)
                                        var cur_budget = prev_game_record[index].budget + cur_round_profit;
                                        // 이전 예산과의 차이 계산
                                        var cur_psum = cur_budget - prev_game_record[index].budget;
                                        var cur_id = record.id;
    
                                        // game_record 테이블 업데이트 (총 에너지, 가격, 이익, 예산, 재난 발생 여부)
                                        db.query('UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=?, isdisasteroccured=? WHERE id=? AND round=? AND room_id=?',
                                            [total_one, price_one, cur_round_profit, cur_budget, cur_psum, 1, cur_id, user_round, room_number],
                                            function (err7) {
                                                if (err7) {
                                                    console.log('update parame', err7); // 오류 발생 시 로그 출력
                                                } else {
                                                    finished(); // 각 사용자의 기록이 업데이트될 때마다 호출
                                                }
                                            }
                                        );
                                    }
                                });
                            });
                        } else {
                            // 재난이 발생하지 않는 일반 라운드 처리
                            var total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
                            var price_one = Math.max(0, total_one); // 총 에너지는 음수가 될 수 없으므로 최소 0
                            var finished = _.after(record_info.length, function () {
                                add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
                            });
    
                            // 각 사용자의 게임 기록 업데이트
                            record_info.forEach((record, index) => {
                                var cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one); // 수익 계산
                                var cur_budget = prev_game_record[index].budget + cur_round_profit; // 새로운 예산 계산
                                var cur_psum = cur_budget - prev_game_record[index].budget; // 이전 예산과의 차이 계산
                                var cur_id = record.id;
    
                                // game_record 테이블 업데이트 (총 에너지, 가격, 이익, 예산)
                                db.query('UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=? WHERE id=? AND round=? AND room_id=?',
                                    [total_one, price_one, cur_round_profit, cur_budget, cur_psum, cur_id, user_round, room_number],
                                    function (err7) {
                                        if (err7) {
                                            console.log('update parame', err7); // 오류 발생 시 로그 출력
                                        } else {
                                            finished(); // 각 사용자의 기록이 업데이트될 때마다 호출
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

    function proceedToNextStep(admin_round, room_number, user_submit_list, io) {
        // admin_round가 32 이하인 경우, 다음 라운드를 위해 타이머를 설정
        if (admin_round <= 32) { 
            make_room_timer(room_number, admin_round + 1, io); // admin_round를 1 증가시켜 타이머를 설정
        } else if (admin_round > 32) { 
            // admin_round가 32보다 큰 경우, 게임 종료 처리
            db.query('UPDATE users SET status=5 WHERE room=?', [room_number], function (err2) {
                if (err2) {
                    console.log('end game', err2); // 오류 발생 시 로그 출력
                } else {
                    // 모든 사용자들의 상태를 '5'로 변경 (게임 종료 상태)
                    user_submit_list.forEach(user => {
                        io.message(io.user_2_socket_id['admin'], 'change_user_status', {
                            user_id: user.id,
                            status: '5'
                        });
                    });
                    // 관리자에게 방의 라운드 종료 메시지 전송
                    io.message(io.user_2_socket_id['admin'], 'change_room_round', {
                        round: 'end',
                        room_number: room_number
                    });
                    // 게임 정보에서 해당 방의 상태를 'room_status=3' (게임 종료)로 업데이트
                    db.query('UPDATE game_info SET room_status=3 WHERE room_id=?', [room_number], function (err3) {
                        if (err3) {
                            console.error('game end err', err3); // 오류 발생 시 로그 출력
                        }
                    });
                }
            });
        }
    }

    function add_admin(admin_round, room_number, user_submit_list, io) {
        // game_record 테이블에 관리자(admin)의 기록을 삽입 (admin_round, room_id, 시작 시간)
        db.query("INSERT INTO game_record (round, id, room_id, start_time) VALUES(?, 'admin', ?, ?)", [admin_round, room_number, Date.now()], function (err2) {
            if (err2) {
                if (err2.code === 'ER_DUP_ENTRY') {
                    // 중복된 삽입이 발생한 경우, 로그에 중복 경고 출력
                    console.log('ignore duplicate', admin_round);
                } else {
                    // 삽입 중 다른 오류가 발생한 경우, 로그에 오류 메시지 출력
                    console.log('insert admin game error', err2);
                }
            } else {
                // admin_round가 13, 20, 27인 경우에는 동일한 province_id에 속한 모든 방의 사용자들의 wait_other 값을 0으로 설정 (공동체 만족도 질문할 때 PROVINCE 같은 그룹의 정보 필요)
                if ([13, 20, 27].includes(admin_round)) {
                    // room_id로부터 province_id를 조회
                    db.query('SELECT province_id FROM game_info WHERE room_id=?', [room_number], function(err4, game_info) {
                        if (err4) {
                            console.error('Error getting province_id:', err4); // 오류 발생 시 로그 출력
                        } else {
                            var province_id = game_info[0].province_id;
                            // 해당 province_id에 속한 모든 방(room_id)을 조회
                            db.query('SELECT room_id FROM game_info WHERE province_id=?', [province_id], function(err5, rooms_in_province) {
                                if (err5) {
                                    console.error('Error getting rooms in province:', err5); // 오류 발생 시 로그 출력
                                } else {
                                    let completedRooms = 0; // 완료된 방의 개수를 추적
                                    const totalRooms = rooms_in_province.length; // 총 방 개수
    
                                    // 각 방에 속한 사용자들의 wait_other 값을 0으로 설정
                                    rooms_in_province.forEach(room => {
                                        db.query('UPDATE users SET wait_other=0 WHERE room=?', [room.room_id], function (err3) {
                                            if (err3) {
                                                console.log('Error updating wait_other for users in room:', room.room_id, err3); // 오류 발생 시 로그 출력
                                            } else {
                                                // 해당 방에 속한 모든 사용자에게 상태 변경 메시지 전송
                                                db.query('SELECT id FROM users WHERE room=?', [room.room_id], function(err6, users_in_room) {
                                                    if (err6) {
                                                        console.error('Error getting users in room:', room.room_id, err6); // 오류 발생 시 로그 출력
                                                    } else {
                                                        users_in_room.forEach(user => {
                                                            io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', ''); // 사용자에게 새로고침
                                                        });
                                                    }
                                                });
                                            }
    
                                            completedRooms++; // 완료된 방 개수 증가
                                            // 모든 방에 대해 업데이트가 완료된 경우, 다음 단계로 진행
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
                                console.log('update user wait 0', user.id, err3); // 오류 발생 시 로그 출력
                            } else {
                                // 사용자에게 상태 변경 메시지 전송
                                io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
                            }
                        });
                    });
                    // 모든 작업이 완료되면 다음 단계로 진행
                    proceedToNextStep(admin_round, room_number, user_submit_list, io);
                }
            }
        });
    }


    
    return {
        make_room_timer: make_room_timer,
        stop_room_timer: stop_room_timer,
        cal_round: cal_round
    };
}());

module.exports = game_control;
