var db = require('./mysql_');
var _ = require('lodash');
const { check } = require('express-validator');
const { pool } = require('./mysql_');

var game_control = (function () {
    var room_timer = {};

    // 특정 방과 라운드에 대한 타이머를 설정하는 함수. 타이머는 122초(120초 + 2초 지연)
    var make_room_timer = function (room_number, round, io) {
        room_timer[room_number] = setTimeout(() => {
            room_time_out(room_number, round, io);
        }, 122 * 1000); // 122초 지연
    };

    // 특정 방의 타이머를 중지하는 함수
    
    // Timer를 중지하는 함수
const stop_room_timer = (room_number) => {
    clearTimeout(room_timer[room_number]);
};

    // 라운드 시간 초과 처리를 위한 함수
    async function room_time_out(room_number, round, io) {
        console.log(`room_time_out called for room: ${room_number}, round: ${round}`);

        const user_round = Number(round) - 1;
        const admin_round = round;

        // 트랜잭션 시작
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // 유저 제출 목록과 삽입할 유저 식별
            const { user_submit_list, users_to_insert } = await fetchUserSubmitList(connection, room_number);

            if (users_to_insert.length === 0) {
                console.log(`No users to insert, calling cal_round directly for room: ${room_number}`);
                await cal_round(connection, room_number, user_round, admin_round, user_submit_list, io);
            } else {
                console.log(`Inserting missing users for room: ${room_number}`);
                await insertMissingUsers(connection, users_to_insert, user_round, room_number);

                console.log(`All inserts finished for room: ${room_number}, calling cal_round`);
                await cal_round(connection, room_number, user_round, admin_round, user_submit_list, io);
            }

            await connection.commit(); // 트랜잭션 커밋
        } catch (err) {
            await connection.rollback(); // 에러 발생 시 롤백
            console.error('room_time_out error:', err);
        } finally {
            connection.release(); // 커넥션 해제
        }
    }

    // 유저 제출 목록을 가져오고 제출하지 않은 유저를 식별하는 함수
    async function fetchUserSubmitList(connection, room_number) {
        try {
            const [user_submit_list] = await connection.query('SELECT id, wait_other FROM users WHERE room=?', [room_number]);
            const users_to_insert = user_submit_list.filter(user => user.wait_other === 0);
            console.log(`User submit list: ${JSON.stringify(user_submit_list)}`);
            console.log(`Number of users who did not submit: ${users_to_insert.length}`);
            return { user_submit_list, users_to_insert };
        } catch (err) {
            console.error('Error fetching user submit list:', err);
            throw err;
        }
    }

    // 제출하지 않은 유저들을 게임 기록에 삽입하는 함수 (트랜잭션 포함)
    async function insertMissingUsers(connection, users_to_insert, user_round, room_number) {
        if (users_to_insert.length === 0) {
            console.log("No users to insert.");
            return;
        }

        try {
            // 트랜잭션 시작
            await connection.beginTransaction();

            // 배치 삽입을 위한 데이터 준비
            const values = users_to_insert.map((user) => [
                user_round,
                user.id,
                room_number,
                Date.now(),
                0,
                0,
            ]);

            try {
                // 배치 INSERT 쿼리 실행
                await connection.query(
                    `INSERT INTO game_record 
                    (round, id, room_id, start_time, input_one, input_two) 
                    VALUES ?`,
                    [values]
                );
                console.log(`Inserted ${users_to_insert.length} users successfully.`);
            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    console.warn('Duplicate entries detected. Some users were skipped.');
                } else {
                    throw new Error(`Batch insert failed: ${err.message}`);
                }
            }

            // 트랜잭션 커밋
            await connection.commit();
        } catch (err) {
            console.error('Transaction failed:', err.message);

            // 트랜잭션 롤백
            try {
                await connection.rollback();
                console.warn('Transaction rolled back.');
            } catch (rollbackErr) {
                console.error('Rollback failed:', rollbackErr.message);
            }

            // 에러 재던지기
            throw err;
        }
    }


    const cal_round = async function (room_number, user_round, admin_round, user_submit_list, io) {
        stop_room_timer(room_number); // Stop the timer
    
        // Notify the admin about the round change
        io.message(io.user_2_socket_id['admin'], 'change_room_round', { 
            round: admin_round,
            room_number: room_number
        });
    
        const connection = await db.getConnection(); // 트랜잭션을 위해 연결 가져오기
    
        try {
            await connection.beginTransaction(); // 트랜잭션 시작
    
            // Fetch game parameters
            const [parameters] = await connection.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number]);
    
            const [game_records] = await connection.query(
                "SELECT id, price_one, budget, input_one, input_two, round FROM game_record WHERE (round=? OR round=?) AND room_id=? AND id!='admin'",
                [user_round - 1, user_round, room_number]
            );
    
            // Separate previous and current records based on round
            const prev_game_record = game_records.filter(record => record.round === user_round - 1);
            const record_info = game_records.filter(record => record.round === user_round);
    
            // Fetch current game type
            const [userGameType] = await connection.query('SELECT game_type FROM game_info WHERE room_id=?', [room_number]);
    
            // Determine which round function to call
            const essContributionRounds = [6, 19, 26];
            const communitySatisfactionRounds = [13, 20, 27];
            const mainGameRounds = [7, 8, 9, 10, 11];
            
            if (user_round < 6) { 
                await processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (essContributionRounds.includes(user_round)) { 
                await processEnergyContribution(record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (user_round ==  12) { 
                await selectDisasterRounds(parameters, room_number); 
                await processEnergyContribution(record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (mainGameRounds.includes(user_round)) {  
                await processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (communitySatisfactionRounds.includes(user_round)) { 
                await processNewBudget(record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io);
            } else { 
                await processdisaster(record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io);
            }
    
            await connection.commit(); // 트랜잭션 성공 시 커밋
        } catch (err) {
            await connection.rollback(); // 오류 발생 시 롤백
            console.error('Error in cal_round:', err);
        } finally {
            connection.release(); // 연결 해제
        }
    };

    // Function to select disaster rounds based on the specified number
    async function selectDisasterRounds(parameters, room_number) {
        const maxDisasters = 5;
        const disasterRounds = [15, 16, 17, 18, 22, 23, 24, 25, 29, 30, 31, 32];
        const selectedDisasters = [];

        // Limit the number of disasters to the specified maximum
        const disasterCount = Math.min(parameters[0].disaster_number, maxDisasters);

        // Select unique disaster rounds
        for (let i = 0; i < disasterCount; i++) {
            const randomIndex = Math.floor(Math.random() * disasterRounds.length);
            selectedDisasters.push(disasterRounds[randomIndex]);
            disasterRounds.splice(randomIndex, 1); // Remove selected round to prevent duplication
        }

        // Sort the selected disasters for consistency
        selectedDisasters.sort((a, b) => a - b);

        // Assign selected rounds to variables
        const [first, second, third, forth, fifth] = selectedDisasters;

        try {
            // Update the game_parameter with the selected disaster rounds
            await db.query(
                'UPDATE game_parameter SET first_disaster=?, second_disaster=?, third_disaster=?, forth_disaster=?, fifth_disaster=? WHERE room_id=?',
                [first || 0, second || 0, third || 0, forth || 0, fifth || 0, room_number]
            );
            console.log('game_parameter updated successfully');
        } catch (error) {
            console.error('Error updating game_parameter:', error);
        }

        return { first, second, third, forth, fifth };
    }




    async function processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) { 
        const connection = await db.getConnection(); // 트랜잭션을 위해 연결 가져오기
    
        try {
            await connection.beginTransaction(); // 트랜잭션 시작
    
            var total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
            var price_one = Math.max(0, total_one); // P = sum of input_one, 0은 넘을 수 없음
    
            const finished = _.after(record_info.length, async function () {
                await add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
            });
    
            const firstround_with_no_record = new Set([1, 7]);
            const firstRounds = new Set([1, 7, 14, 21, 28]);
    
            for (const record of record_info) {
                var cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one);
                var cur_budget, cur_psum;
                var prev_record = prev_game_record.find(r => r.id === record.id);
    
                if (firstround_with_no_record.has(user_round)) {  
                    cur_budget = parameters[0].init_budget + cur_round_profit;
                    cur_psum = cur_budget - parameters[0].init_budget;
                } else if (firstRounds.has(user_round)) {
                    cur_budget = prev_record.budget + parameters[0].init_budget + cur_round_profit;
                    cur_psum = cur_budget - prev_record.budget;
                } else {
                    cur_budget = prev_record.budget + cur_round_profit;
                    cur_psum = cur_budget - prev_record.budget;
                }
    
                var cur_id = record.id;
    
                try {
                    await connection.query('UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=? WHERE id=? AND round=? AND room_id=?',
                        [total_one, price_one, cur_round_profit, cur_budget, cur_psum, cur_id, user_round, room_number]);
    
                    finished();
                } catch (err7) {
                    console.log('update param error:', err7);
                    throw err7; // 트랜잭션 롤백을 위해 오류를 다시 던집니다.
                }
            }
    
            await connection.commit(); // 모든 업데이트 성공 시 커밋
        } catch (err) {
            await connection.rollback(); // 오류 발생 시 롤백
            console.error('Error in processNormalGame:', err);
        } finally {
            connection.release(); // 연결 해제
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////// ESS 라운드 
    // Main function for processing energy contributions based on game type

   async function processEnergyContribution(recordInfo, prevGameRecord, userGameType, parameters, roomNumber, userRound, adminRound, userSubmitList, io) {
    const connection = await db.getConnection(); // 트랜잭션을 위해 연결 가져오기

    try {
        await connection.beginTransaction(); // 트랜잭션 시작

        const sumEnergy = recordInfo.reduce((acc, curr) => acc + curr.input_one, 0);
        let usableEnergy, adjustmentFn;

        const province_id = parameters[0].province_id;

        // Set type-specific variables
        switch (userGameType[0].game_type) {
            case 1:
                usableEnergy = sumEnergy > 0 ? (sumEnergy / 5) / 4 : 0;
                adjustmentFn = record => record.input_one;
                break;
            case 2:
                usableEnergy = sumEnergy > 0 ? (sumEnergy / 4) : 0;
                adjustmentFn = () => (sumEnergy / 4) * 1.25;
                break;
            case 3:
                usableEnergy = sumEnergy > 0 ? (sumEnergy / 5) / 4 : 0;
                adjustmentFn = record => record.input_one;
                break;
            default:
                console.log("Invalid game type");
                return;
        }

        // Update game parameters and insert total energy record
        await updateGameParameter(usableEnergy, roomNumber, connection);
        await insertTotalEnergyRecord(userRound, roomNumber, sumEnergy, province_id, connection);

        // Process each record
        await processRecords(recordInfo, prevGameRecord, sumEnergy, usableEnergy, userRound, roomNumber, adminRound, userSubmitList, io, adjustmentFn, userGameType[0].game_type, connection);

        await connection.commit(); // 모든 작업이 성공 시 커밋
    } catch (paramErr) {
        await connection.rollback(); // 오류 발생 시 롤백
        console.log('Error in processEnergyContribution:', paramErr);
    } finally {
        connection.release(); // 연결 해제
    }
}

    // Helper function to update game parameters with total energy
    async function updateGameParameter(totalEnergy, roomNumber, connection) {
        await connection.query('UPDATE game_parameter SET total_energy=? WHERE room_id=?', [totalEnergy, roomNumber]);
    }

    // Helper function to insert total energy record
    async function insertTotalEnergyRecord(userRound, roomNumber, sumEnergy, province_id, connection) {
        await connection.query("INSERT INTO total_energy_record (round, province_id, room_id, total_energy) VALUES(?, ?, ?, ?)", 
                    [userRound, province_id, roomNumber, sumEnergy]);
    }

    async function processRecords(recordInfo, prevGameRecord, sumEnergy, usableEnergy, userRound, roomNumber, adminRound, userSubmitList, io, adjustmentFn, gameType, connection) {
        const finished = _.after(recordInfo.length, async () => {
            await add_admin(adminRound, roomNumber, userSubmitList, io);
        }); 
    
        for (const record of recordInfo) {
            const prevRecord = prevGameRecord.find(r => r.id === record.id);
            const adjustment = adjustmentFn(record);
            const contributionDividends = gameType === 3 && sumEnergy > 0 
                ? 15 * (sumEnergy / 37.5) * (record.input_one / sumEnergy)
                : 0;
    
            try {
                await budgetUpdateFn(record, prevRecord, adjustment, contributionDividends, sumEnergy, userRound, roomNumber, connection); // `connection` 인자 추가
                finished(); // 각 업데이트가 완료될 때마다 finished 호출
            } catch (err) {
                console.log('Error updating game record:', err);
                throw err; // 트랜잭션 롤백을 위해 오류를 다시 던집니다.
            }
        }
    }

    // Function to update budget based on calculations
    async function budgetUpdateFn(record, prevRecord, adjustment, contributionDividends, sumEnergy, userRound, roomNumber, connection) {
        const budgetUpdateQuery = 'UPDATE game_record SET budget=?, contribution_profit=?, total_one=? WHERE id=? AND round=? AND room_id=?';
        const updateValues = [
            prevRecord.budget - adjustment,
            contributionDividends,
            sumEnergy,
            record.id,
            userRound,
            roomNumber
        ];
        await connection.query(budgetUpdateQuery, updateValues);
    }
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    async function processNewBudget(record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io) {
        const connection = await db.getConnection(); // 트랜잭션을 위해 연결 가져오기
    
        try {
            await connection.beginTransaction(); // 트랜잭션 시작
    
            const finished = _.after(record_info.length, async function () {
                await add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
            });
    
            for (const record of record_info) {
                const prev_record = prev_game_record.find(r => r.id === record.id);
                const cur_budget = prev_record.budget;
                const cur_id = record.id;
    
                try {
                    // 트랜잭션 내에서 `connection`을 사용하여 쿼리 실행
                    await connection.query('UPDATE game_record SET budget=? WHERE id=? AND round=? AND room_id=?',
                        [cur_budget, cur_id, user_round, room_number]);
                    
                    finished();
                } catch (err7) {
                    console.log('update budget error:', err7);
                    throw err7; // 오류 발생 시 상위 트랜잭션에서 롤백되도록 오류를 던집니다.
                }
            }
    
            await connection.commit(); // 모든 작업이 성공 시 커밋
        } catch (err) {
            await connection.rollback(); // 오류 발생 시 롤백
            console.error('Error in processNewBudget:', err);
        } finally {
            connection.release(); // 연결 해제
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // 재난이 일어날 라운드면 processdisasterround로, 그렇지 않으면 그냥 processnormalround로

    async function processdisaster(record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io) {
        const connection = await db.getConnection(); // 트랜잭션을 위해 연결 가져오기
    
        try {
            await connection.beginTransaction(); // 트랜잭션 시작
    
            // Check if the current round is a disaster round
            const isDisasterRound = await checkDisasterRound(parameters, room_number, user_round);
    
            if (isDisasterRound) {
                // If it's a disaster round, call processDisasterRound
                await processDisasterRound(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io, connection);
            } else {
                // If it's not a disaster round, call processNormalGame
                await processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io, connection);
            }
    
            await connection.commit(); // 모든 작업이 성공 시 커밋
        } catch (error) {
            await connection.rollback(); // 오류 발생 시 롤백
            console.error("Error in processdisaster function:", error);
        } finally {
            connection.release(); // 연결 해제
        }
    }

    async function checkDisasterRound(parameters, roomNumber, userRound, connection) { // disaster round인지 확인
        try {
            // Check if the next round is a disaster round
            const disasterRounds = [
                parameters[0].first_disaster - 1,
                parameters[0].second_disaster - 1,
                parameters[0].third_disaster - 1,
                parameters[0].fourth_disaster - 1,
                parameters[0].fifth_disaster - 1
            ];
            const isDisasterRound = disasterRounds.includes(userRound) ? 1 : 0;
    
            // Update disaster occurrence status in the game_parameter table
            await connection.query('UPDATE game_parameter SET isdisasteroccured = ? WHERE room_id = ?', [isDisasterRound, roomNumber]);
            
            // Return the result to use in calling function if needed
            return isDisasterRound;
    
        } catch (error) {
            console.error("Error in checkDisasterRound function:", error);
            throw error;  // Re-throw the error to handle it in the calling function if needed
        }
    }

    async function processDisasterRound(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) {
        try {
            await connection.beginTransaction(); // 트랜잭션 시작
    
            const total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
    
            // 모든 작업이 완료되면 호출될 finished 콜백 설정
            const finished = _.after(record_info.length, async function () {
                await add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
            });
    
            // 각 사용자의 기록을 비동기적으로 업데이트
            for (const record of record_info) {
                const prev_record = prev_game_record.find(r => r.id === record.id);
                let cur_round_profit;
    
                // game_type이 3인 경우, 재난 기여를 고려한 수익 계산
                if (record_info[0].game_type == 3) {
                    cur_round_profit = ((parameters[0].price_var * record.input_one) - (parameters[0].adjusted_w * record.input_one)) + community_game_record.contribution_profit;
                } else {
                    // 일반적인 수익 계산 (가격 변동 * input_one)
                    cur_round_profit = (parameters[0].price_var * record.input_one) - (parameters[0].adjusted_w * record.input_one);
                }
    
                // 현재 라운드 예산 계산 (이전 예산 + 수익)
                const cur_budget = prev_record.budget + cur_round_profit;
                // 이전 예산과의 차이 계산
                const cur_psum = cur_budget - prev_record.budget;
    
                try {
                    // 트랜잭션 내에서 `connection`을 사용하여 쿼리 실행
                    await connection.query(
                        'UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=?, isdisasteroccured=? WHERE id=? AND round=? AND room_id=?',
                        [total_one, parameters[0].adjusted_w, cur_round_profit, cur_budget, cur_psum, 1, record.id, user_round, room_number]
                    );
                    finished();
                } catch (err) {
                    console.log('Error updating game record:', err); // 업데이트 중 오류 발생 시 로그 출력
                    throw err; // 트랜잭션 롤백을 위해 오류를 다시 던집니다.
                }
            }
    
            await connection.commit(); // 모든 작업이 성공 시 커밋
        } catch (err) {
            await connection.rollback(); // 오류 발생 시 롤백
            console.log('Error in processDisasterRound:', err);
        }
    }


    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


    async function proceedToNextStep(admin_round, room_number, user_submit_list, io) { // 방 종료시키는 함수
        // admin_round가 32 이하인 경우, 다음 라운드를 위해 타이머를 설정
        if (admin_round <= 32) { 
            make_room_timer(room_number, admin_round + 1, io); // admin_round를 1 증가시켜 타이머를 설정
        } else if (admin_round > 32) { 
            // admin_round가 32보다 큰 경우, 게임 종료 처리
            const connection = await db.getConnection(); // 트랜잭션을 위해 연결 가져오기
    
            try {
                await connection.beginTransaction(); // 트랜잭션 시작
    
                // 모든 사용자들의 상태를 '5'로 업데이트 (게임 종료 상태)
                await connection.query('UPDATE users SET status=5 WHERE room=?', [room_number]);
    
                // 모든 사용자에게 상태 변경 메시지를 전송
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
                await connection.query('UPDATE game_info SET room_status=3 WHERE room_id=?', [room_number]);
    
                await connection.commit(); // 모든 작업이 성공 시 커밋
            } catch (err) {
                await connection.rollback(); // 오류 발생 시 롤백
                console.log('Error ending game:', err); // 오류 발생 시 로그 출력
            } finally {
                connection.release(); // 연결 해제
            }
        }
    }
    
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //////admin functions

    async function add_admin(admin_round, room_number, user_submit_list, io) {
        const connection = await db.getConnection(); // 트랜잭션을 위해 연결 가져오기
    
        try {
            await connection.beginTransaction(); // 트랜잭션 시작
    
            // 관리자의 게임 기록 추가
            await insertAdminGameRecord(admin_round, room_number, connection);
    
            if ([13, 20, 27].includes(admin_round)) {
                // 특정 라운드에서는 province 업데이트를 수행
                await updateWaitOtherForProvince(room_number, admin_round, user_submit_list, io, connection);
            } else {
                // 일반 라운드에서는 사용자 업데이트와 다음 단계로 진행
                await updateWaitOtherForUsers(user_submit_list, io, connection);
                await proceedToNextStep(admin_round, room_number, user_submit_list, io, connection);
            }
    
            await connection.commit(); // 모든 작업이 성공 시 커밋
        } catch (error) {
            await connection.rollback(); // 오류 발생 시 롤백
            console.error('Error in add_admin:', error);
        } finally {
            connection.release(); // 연결 해제
        }
    }

    // 다른 그룹 사용자들 확인 및 업데이트
async function updateWaitOtherForProvince(room_number, admin_round, user_submit_list, io, connection) {
    try {
        const [[{ province_id }]] = await connection.query('SELECT province_id FROM game_info WHERE room_id=?', [room_number]);
        const [rooms_in_province] = await connection.query('SELECT room_id FROM game_info WHERE province_id=?', [province_id]);

        for (const room of rooms_in_province) {
            await connection.query('UPDATE users SET wait_other=0 WHERE room=?', [room.room_id]);
            await notifyUsers(room.room_id, io, connection);
        }

        await proceedToNextStep(admin_round, room_number, user_submit_list, io, connection);
    } catch (error) {
        console.error('Error updating wait_other for province:', error);
        throw error;
    }
}

// 관리자의 다음 라운드 진행 또는 게임 종료 처리
async function proceedToNextStep(admin_round, room_number, user_submit_list, io, connection) {
    if (admin_round <= 32) {
        make_room_timer(room_number, admin_round + 1, io);
    } else {
        try {
            await connection.query('UPDATE users SET status=5 WHERE room=?', [room_number]);
            user_submit_list.forEach(user => {
                io.message(io.user_2_socket_id['admin'], 'change_user_status', { user_id: user.id, status: '5' });
            });
            io.message(io.user_2_socket_id['admin'], 'change_room_round', { round: 'end', room_number: room_number });
            await connection.query('UPDATE game_info SET room_status=3 WHERE room_id=?', [room_number]);
        } catch (err) {
            console.error('Error ending game:', err);
            throw err;
        }
    }
}

// 각 사용자 상태 갱신 및 알림
async function updateWaitOtherForUsers(user_submit_list, io, connection) {
    for (const user of user_submit_list) {
        try {
            await connection.query('UPDATE users SET wait_other=0 WHERE id=?', [user.id]);
            io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
        } catch (error) {
            console.error(`Error updating user ${user.id} wait_other`, error);
            throw error;
        }
    }
}

// 방 내 사용자 알림
async function notifyUsers(room_id, io, connection) {
    try {
        const [users_in_room] = await connection.query('SELECT id FROM users WHERE room=?', [room_id]);
        for (const user of users_in_room) {
            io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
        }
    } catch (error) {
        console.error(`Error notifying users in room ${room_id}:`, error);
        throw error;
    }
}

// 관리자 게임 기록 추가
async function insertAdminGameRecord(admin_round, room_number, connection) {
    try {
        await connection.query("INSERT INTO game_record (round, id, room_id, start_time) VALUES(?, 'admin', ?, ?)", [admin_round, room_number, Date.now()]);
    } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') console.error('Insert admin game record error:', err);
        throw err;
    }
}
  
  // Expose timer functions and round calculation
  return {
    make_room_timer: make_room_timer,
    stop_room_timer: stop_room_timer,
    cal_round: cal_round
  };
}());

module.exports = game_control;
