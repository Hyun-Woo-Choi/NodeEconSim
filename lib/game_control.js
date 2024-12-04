var db = require('./mysql_');
var _ = require('lodash');
const { pool } = require('./mysql_');

var game_control = (function () {
    var room_timer = {};

    // 특정 방과 라운드에 대한 타이머를 설정하는 함수. 타이머는 122초(120초 + 2초 지연)
    var make_room_timer = function (room_number, round, io, connection) {
        room_timer[room_number] = setTimeout(() => {
            room_time_out(room_number, round, io, connection);
        }, 122 * 1000); // 122초 지연
    };

    // 특정 방의 타이머를 중지하는 함수

    const stop_room_timer = (room_number) => {
        clearTimeout(room_timer[room_number]);
    };
    
    async function room_time_out(room_number, round, io, connection) {
        console.log(`room_time_out called for room: ${room_number}, round: ${round}`);
    
        const user_round = Number(round) - 1;
        const admin_round = round;
    
        if (!connection) {
            throw new Error("Database connection is required for room_time_out");
        }
    
        try {
            // 유저 제출 목록과 삽입할 유저 식별
            const { user_submit_list, users_to_insert } = await fetchUserSubmitList(connection, room_number);
    
            if (users_to_insert.length > 0) {
                console.log(`Inserting missing users for room: ${room_number}`);
                await insertMissingUsers(connection, users_to_insert, user_round, room_number);
                console.log("Inserted missing users. Proceeding to cal_round.");
            } else {
                console.log(`No missing users to insert for room: ${room_number}. Proceeding to cal_round.`);
            }
    
            console.log(`Calling cal_round for room: ${room_number}, round: ${user_round}`);
            await cal_round(room_number, user_round, admin_round, user_submit_list, io, connection);
        } catch (err) {
            console.error("Error in room_time_out:", err);
        } finally {
            // Ensure the connection is properly released
            try {
                connection.release();
                console.log("Database connection released for room_time_out.");
            } catch (releaseErr) {
                console.error("Error releasing connection in room_time_out:", releaseErr);
            }
        }
    }

    async function fetchUserSubmitList(connection, room_number) {
        try {
            console.log(`Fetching user submit list for room: ${room_number}`);
    
            // users 테이블에서 해당 room_number에 속한 유저 목록 가져오기
            const [user_submit_list] = await connection.query(
                'SELECT id, wait_other FROM users WHERE room=?',
                [room_number]
            );
    
            // 제출하지 않은 유저 필터링
            const users_to_insert = user_submit_list.filter(user => user.wait_other === 0);
    
            console.log(`Fetched ${user_submit_list.length} users for room: ${room_number}`);
            console.log(`Users to insert: ${users_to_insert.length}`);
    
            return { user_submit_list, users_to_insert };
        } catch (err) {
            console.error(`Error fetching user submit list for room: ${room_number}`, err);
            throw err; // 에러를 상위 함수로 전달
        }
    }

    async function insertMissingUsers(connection, users_to_insert, user_round, room_number) {
        if (users_to_insert.length === 0) {
            console.log("No users to insert.");
            return;
        }
    
        try {
            const values = users_to_insert.map(user => [user_round, user.id, room_number, Date.now(), 0, 0]); // Prepare batch insert values
            const query = `
                INSERT INTO game_record (round, id, room_id, start_time, input_one, input_two) 
                VALUES ? ON DUPLICATE KEY UPDATE start_time = VALUES(start_time)
            `; // Batch insert query with conflict resolution
            await connection.query(query, [values]); // Execute query
            console.log(`Inserted ${users_to_insert.length} users successfully.`);
        } catch (err) {
            console.error('Error inserting missing users:', err.message);
            throw err;
        }
    }
    

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const cal_round = async function (room_number, user_round, admin_round, user_submit_list, io) {
        stop_room_timer(room_number); // Stop the timer
    
        // Notify the admin about the round change
        if (io.user_2_socket_id && io.user_2_socket_id['admin']) {
            io.message(io.user_2_socket_id['admin'], 'change_room_round', { 
                round: admin_round,
                room_number: room_number
            });
        } else {
            console.warn('Admin socket ID not found.');
        }
    
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
                await processNormalGame(connection, record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (essContributionRounds.includes(user_round)) {
                await processEnergyContribution(connection, record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (user_round === 12) {
                await selectDisasterRounds(connection, parameters, room_number);
                await processEnergyContribution(connection, record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (mainGameRounds.includes(user_round)) {
                await processNormalGame(connection, record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (communitySatisfactionRounds.includes(user_round)) {
                await processNewBudget(connection, record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io);
            } else {
                await processdisaster(connection, record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io);
            }
    
            await connection.commit(); // 트랜잭션 성공 시 커밋
        } catch (err) {
            try {
                await connection.rollback(); // 오류 발생 시 롤백
                console.warn('Transaction rolled back successfully.');
            } catch (rollbackErr) {
                console.error('Rollback failed:', rollbackErr.message);
            }
            console.error('Error in cal_round:', err);
        } finally {
            if (connection) {
                connection.release(); // 연결 해제
            }
        }
    };

    // Function to select disaster rounds based on the specified number
    async function selectDisasterRounds(connection, parameters, room_number) {
        const maxDisasters = 5; // 최대 재난 개수
        const disasterRounds = [15, 16, 17, 18, 22, 23, 24, 25, 29, 30, 31, 32];

        // parameters[0].disaster_number 값 확인
        const disasterCount = Math.min(parameters?.[0]?.disaster_number || 0, maxDisasters);

        if (disasterCount <= 0) {
            console.warn('No disasters to select. Skipping selection.');
            return { first: 0, second: 0, third: 0, forth: 0, fifth: 0 };
        }

        // 랜덤한 재난 라운드 선택
        const selectedDisasters = [];
        const availableRounds = [...disasterRounds]; // 원본 배열 보호

        while (selectedDisasters.length < disasterCount && availableRounds.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableRounds.length);
            selectedDisasters.push(availableRounds[randomIndex]);
            availableRounds.splice(randomIndex, 1); // 중복 방지
        }

        // 정렬된 재난 라운드
        selectedDisasters.sort((a, b) => a - b);

        // 최대 5개의 재난 라운드로 정렬 후 패딩
        const paddedDisasters = [...selectedDisasters, 0, 0, 0, 0].slice(0, maxDisasters);

        try {
            // game_parameter 테이블 업데이트
            await connection.query(
                'UPDATE game_parameter SET first_disaster=?, second_disaster=?, third_disaster=?, forth_disaster=?, fifth_disaster=? WHERE room_id=?',
                [...paddedDisasters, room_number]
            );
            console.log('game_parameter updated successfully:', paddedDisasters);
        } catch (error) {
            console.error('Error updating game_parameter:', error);
            throw error; // 에러 재던지기
        }

        // 반환 데이터 간소화
        return {
            first: paddedDisasters[0],
            second: paddedDisasters[1],
            third: paddedDisasters[2],
            forth: paddedDisasters[3],
            fifth: paddedDisasters[4]
        };
    }


    async function processNormalGame(connection, record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) {
        try {
            // 총 input_one 값 계산
            const total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
            const price_one = Math.max(0, total_one); // 최소값 제한

            const firstround_with_no_record = new Set([1, 7]);
            const firstRounds = new Set([1, 7, 14, 21, 28]);

            // 모든 레코드 처리
            await Promise.all(record_info.map(async (record) => {
                const prev_record = prev_game_record.find(r => r.id === record.id);
                const cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one);
                
                let cur_budget, cur_psum;

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

                // 데이터베이스 업데이트
                try {
                    await connection.query(
                        'UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=? WHERE id=? AND round=? AND room_id=?',
                        [total_one, price_one, cur_round_profit, cur_budget, cur_psum, record.id, user_round, room_number]
                    );
                } catch (updateError) {
                    console.error(`Error updating record for user ID ${record.id}:`, updateError);
                    throw updateError;
                }
            }));

            // 모든 작업 완료 후 관리자 업데이트
            await add_admin(admin_round, room_number, user_submit_list, io);

            console.log(`Normal game processing completed for round ${user_round}, room ${room_number}`);
        } catch (err) {
            console.error('Error in processNormalGame:', err);
            throw err; // 상위 함수에서 롤백 처리
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////// ESS 라운드 
    // Main function for processing energy contributions based on game type

    async function processEnergyContribution(connection, recordInfo, prevGameRecord, userGameType, parameters, roomNumber, userRound, adminRound, userSubmitList, io) {
        try {
            const sumEnergy = recordInfo.reduce((acc, curr) => acc + curr.input_one, 0);
            const province_id = parameters[0].province_id;
    
            let usableEnergy = 0, adjustmentFn;
            const gameType = userGameType[0]?.game_type;
            if (!gameType) throw new Error("Invalid or missing game type");
    
            switch (gameType) {
                case 1: usableEnergy = sumEnergy > 0 ? (sumEnergy / 5) / 4 : 0; adjustmentFn = record => record.input_one; break;
                case 2: usableEnergy = sumEnergy > 0 ? sumEnergy / 4 : 0; adjustmentFn = () => (sumEnergy / 4) * 1.25; break;
                case 3: usableEnergy = sumEnergy > 0 ? (sumEnergy / 5) / 4 : 0; adjustmentFn = record => record.input_one; break;
                default: throw new Error(`Unhandled game type: ${gameType}`);
            }
    
            await updateGameParameter(usableEnergy, roomNumber, connection);
            await insertTotalEnergyRecord(userRound, roomNumber, sumEnergy, province_id, connection);
    
            await processRecords(recordInfo, prevGameRecord, sumEnergy, usableEnergy, userRound, roomNumber, adminRound, userSubmitList, io, adjustmentFn, gameType, connection);
    
            console.log(`Energy contribution processed successfully for room ${roomNumber}, round ${userRound}`);
        } catch (err) {
            console.error(`Error in processEnergyContribution for room ${roomNumber}, round ${userRound}:`, err);
            throw err;
        }
    }

    // Helper function to update game parameters with total energy
    async function updateGameParameter(totalEnergy, roomNumber, connection) {
        if (typeof totalEnergy !== 'number' || totalEnergy < 0) {
            throw new Error('Invalid totalEnergy value');
        }
        if (!roomNumber) {
            throw new Error('Invalid roomNumber value');
        }

        try {
            await connection.query(
                'UPDATE game_parameter SET total_energy=? WHERE room_id=?',
                [totalEnergy, roomNumber]
            );
            console.log(`Game parameter updated: total_energy=${totalEnergy}, room_id=${roomNumber}`);
        } catch (error) {
            console.error(`Error updating game_parameter for room ${roomNumber}:`, error);
            throw error; // 에러를 호출한 함수로 다시 전달
        }
    }

    async function insertTotalEnergyRecord(userRound, roomNumber, sumEnergy, province_id, connection) {
        if (!Number.isInteger(userRound) || userRound <= 0) throw new Error('Invalid userRound value');
        if (!roomNumber) throw new Error('Invalid roomNumber value');
        if (typeof sumEnergy !== 'number' || sumEnergy < 0) throw new Error('Invalid sumEnergy value');
    
        try {
            await connection.query(
                'INSERT INTO total_energy_record (round, province_id, room_id, total_energy) VALUES (?, ?, ?, ?)',
                [userRound, province_id, roomNumber, sumEnergy]
            );
            console.log(`Total energy record inserted: round=${userRound}, province_id=${province_id}, room_id=${roomNumber}, total_energy=${sumEnergy}`);
        } catch (error) {
            console.error(`Error inserting total energy record for room ${roomNumber}:`, error);
            throw error;
        }
    }

   async function processRecords(recordInfo, prevGameRecord, sumEnergy, usableEnergy, userRound, roomNumber, adminRound, userSubmitList, io, adjustmentFn, gameType, connection) {
    try {
        await Promise.all(recordInfo.map(async (record) => {
            const prevRecord = prevGameRecord.find(r => r.id === record.id);
            const adjustment = adjustmentFn(record);
            const contributionDividends = gameType === 3 && sumEnergy > 0 
                ? 15 * (sumEnergy / 37.5) * (record.input_one / sumEnergy)
                : 0;
            await budgetUpdateFn(record, prevRecord, adjustment, contributionDividends, sumEnergy, userRound, roomNumber, connection);
            console.log(`Record updated successfully for user ID: ${record.id}`);
        }));
        await add_admin(adminRound, roomNumber, userSubmitList, io);
        console.log(`All records processed for room ${roomNumber}, round ${userRound}`);
    } catch (err) {
        console.error('Error processing records:', err);
        throw err;
    }
}

    async function budgetUpdateFn(record, prevRecord, adjustment, contributionDividends, sumEnergy, userRound, roomNumber, connection) {
        if (!prevRecord || !record || !record.id) throw new Error('Invalid record or prevRecord data');
        const budgetUpdateQuery = 'UPDATE game_record SET budget=?, contribution_profit=?, total_one=? WHERE id=? AND round=? AND room_id=?';
        const updateValues = [prevRecord.budget - adjustment, contributionDividends, sumEnergy, record.id, userRound, roomNumber];
        try {
            await connection.query(budgetUpdateQuery, updateValues);
            console.log(`Budget updated for user ID: ${record.id}, round: ${userRound}, room: ${roomNumber}`);
        } catch (error) {
            console.error(`Error updating budget for user ID: ${record.id}, round: ${userRound}, room: ${roomNumber}`, error);
            throw error;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    async function processNewBudget(connection, record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io) {
        try {
            // 모든 레코드에 대한 작업을 병렬로 처리
            await Promise.all(record_info.map(async (record) => {
                const prev_record = prev_game_record.find(r => r.id === record.id);
                if (!prev_record) {
                    console.warn(`Previous record not found for user ID: ${record.id}, skipping.`);
                    return; // 이전 기록이 없으면 현재 레코드 스킵
                }
    
                const cur_budget = prev_record.budget;
    
                try {
                    // 각 사용자에 대한 예산 업데이트
                    await connection.query(
                        'UPDATE game_record SET budget=? WHERE id=? AND round=? AND room_id=?',
                        [cur_budget, record.id, user_round, room_number]
                    );
                    console.log(`Budget updated for user ID: ${record.id}, round: ${user_round}, room: ${room_number}`);
                } catch (updateError) {
                    console.error(`Error updating budget for user ID: ${record.id}, round: ${user_round}, room: ${room_number}`, updateError);
                    // 업데이트 실패 로그만 기록하고 다음 작업으로 진행
                }
            }));
    
            // 모든 작업 완료 후 관리자 업데이트
            await add_admin(admin_round, room_number, user_submit_list, io);
    
            console.log(`processNewBudget completed successfully for room ${room_number}, round ${user_round}`);
        } catch (err) {
            console.error(`Error in processNewBudget for room ${room_number}, round ${user_round}:`, err);
            throw err; // 상위 호출 함수에 에러 전달
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // 재난이 일어날 라운드면 processdisasterround로, 그렇지 않으면 그냥 processnormalround로

    async function processdisaster(connection, record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io) {
        try {
            // 현재 라운드가 재난 라운드인지 확인
            const isDisasterRound = await checkDisasterRound(parameters, room_number, user_round, connection);

            if (isDisasterRound) {
                // 재난 라운드 처리
                console.log(`Processing disaster round: ${user_round} for room: ${room_number}`);
                await processDisasterRound(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io, connection);
            } else {
                // 일반 라운드 처리
                console.log(`Processing normal round: ${user_round} for room: ${room_number}`);
                await processNormalGame(connection, record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
            }

            console.log(`Round ${user_round} processed successfully for room ${room_number}`);
        } catch (error) {
            console.error(`Error in processdisaster for round ${user_round}, room ${room_number}:`, error);
            throw error; // 상위 호출 함수로 에러 전달
        }
    }


    async function checkDisasterRound(parameters, roomNumber, userRound, connection) {
        try {
            // 유효성 검사
            if (!parameters || parameters.length === 0 || !parameters[0]) {
                throw new Error("Invalid or missing parameters");
            }
            if (!roomNumber) {
                throw new Error("Invalid roomNumber");
            }
            if (!Number.isInteger(userRound) || userRound <= 0) {
                throw new Error("Invalid userRound value");
            }

            // Disaster rounds 계산
            const disasterRounds = [
                parameters[0].first_disaster - 1,
                parameters[0].second_disaster - 1,
                parameters[0].third_disaster - 1,
                parameters[0].fourth_disaster - 1,
                parameters[0].fifth_disaster - 1
            ];

            // 현재 라운드가 재난 라운드인지 확인
            const isDisasterRound = disasterRounds.includes(userRound) ? 1 : 0;

            // game_parameter 테이블 업데이트
            await connection.query(
                'UPDATE game_parameter SET isdisasteroccured = ? WHERE room_id = ?',
                [isDisasterRound, roomNumber]
            );

            console.log(`Disaster round check complete for room ${roomNumber}, round ${userRound}. Result: ${isDisasterRound}`);
            return isDisasterRound; // 결과 반환
        } catch (error) {
            console.error(`Error in checkDisasterRound for room ${roomNumber}, round ${userRound}:`, error);
            throw error; // 에러 재던지기
        }
    }


    async function processDisasterRound(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io, connection) {
        try {
            const total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
            const gameType = record_info[0]?.game_type;
    
            if (!parameters[0] || !Number.isFinite(total_one)) {
                throw new Error("Invalid parameters or record information");
            }
    
            // 모든 레코드 업데이트
            await Promise.all(record_info.map(async (record) => {
                const prev_record = prev_game_record.find(r => r.id === record.id);
                if (!prev_record) throw new Error(`Previous record not found for user ID: ${record.id}`);
    
                // 수익 계산
                const contributionProfit = gameType === 3 ? community_game_record.contribution_profit || 0 : 0;
                const cur_round_profit = 
                    (parameters[0].price_var * record.input_one) - 
                    (parameters[0].adjusted_w * record.input_one) + 
                    contributionProfit;
    
                // 예산 계산
                const cur_budget = prev_record.budget + cur_round_profit;
                const cur_psum = cur_budget - prev_record.budget;
    
                try {
                    // 레코드 업데이트
                    await connection.query(
                        'UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=?, isdisasteroccured=? WHERE id=? AND round=? AND room_id=?',
                        [total_one, parameters[0].adjusted_w, cur_round_profit, cur_budget, cur_psum, 1, record.id, user_round, room_number]
                    );
                    console.log(`Game record updated for user ID: ${record.id}, round: ${user_round}`);
                } catch (updateError) {
                    console.error(`Error updating game record for user ID: ${record.id}`, updateError);
                    throw updateError;
                }
            }));
    
            // 관리자 데이터 업데이트
            await add_admin(admin_round, room_number, user_submit_list, io);
            console.log(`Disaster round processed successfully for room ${room_number}, round ${user_round}`);
        } catch (err) {
            console.error(`Error in processDisasterRound for room ${room_number}, round ${user_round}:`, err);
            throw err; // 상위 함수로 에러 전달
        }
    }
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    //////admin functions

    async function add_admin(admin_round, room_number, user_submit_list, io) {
        const connection = await db.getConnection(); // 트랜잭션을 위해 연결 가져오기
        try {
            await connection.beginTransaction(); // 트랜잭션 시작
    
            // 관리자의 게임 기록 추가
            await insertAdminGameRecord(admin_round, room_number, connection);
            console.log(`Admin game record inserted for room ${room_number}, round ${admin_round}`);
    
            if ([13, 20, 27].includes(admin_round)) {
                // 특정 라운드에서 province 업데이트 수행
                console.log(`Updating province for room ${room_number}, round ${admin_round}`);
                await updateWaitOtherForProvince(room_number, admin_round, user_submit_list, io, connection);
            } else {
                // 일반 라운드 처리
                console.log(`Updating users and proceeding to next step for room ${room_number}, round ${admin_round}`);
                await updateWaitOtherForUsers(user_submit_list, io, connection);
                await proceedToNextStep(admin_round, room_number, user_submit_list, io, connection);
            }
            await connection.commit(); // 모든 작업이 성공 시 커밋
            console.log(`Admin actions completed successfully for room ${room_number}, round ${admin_round}`);
        } catch (error) {
            await connection.rollback(); // 오류 발생 시 롤백
            console.error(`Error in add_admin for room ${room_number}, round ${admin_round}:`, error);
            throw error; // 상위 함수로 에러 전달
        } finally {
            connection.release(); // 연결 해제
        }
    }

    async function updateWaitOtherForProvince(room_number, admin_round, user_submit_list, io, connection) {
        try {
            // 현재 방의 province_id를 가져옴
            const [[{ province_id }]] = await connection.query('SELECT province_id FROM game_info WHERE room_id=?', [room_number]);
            if (province_id === null || province_id === undefined) {
                throw new Error(`Province ID not found for room ${room_number}`);
            }
            console.log(`Province ID ${province_id} found for room ${room_number}`);

            // 같은 province에 속한 모든 방의 room_id 가져오기
            const [rooms_in_province] = await connection.query('SELECT room_id FROM game_info WHERE province_id=?', [province_id]);
            if (rooms_in_province.length === 0) {
                console.warn(`No rooms found in province ${province_id}`);
            } else {
                console.log(`Rooms in province ${province_id}:`, rooms_in_province.map(r => r.room_id));
            }

            // 각 방의 사용자 상태 업데이트 및 알림 전송
            for (const room of rooms_in_province) {
                await connection.query('UPDATE users SET wait_other=0 WHERE room=?', [room.room_id]);
                console.log(`Updated wait_other=0 for users in room ${room.room_id}`);
                await notifyUsers(room.room_id, io, connection);
            }

            // 다음 단계 진행
            await proceedToNextStep(admin_round, room_number, user_submit_list, io, connection);
            console.log(`Proceeded to next step for room ${room_number}, round ${admin_round}`);
        } catch (error) {
            console.error(`Error updating wait_other for province in room ${room_number}, round ${admin_round}:`, error);
            throw error; // 상위 함수로 에러 전달
        }
    }


    // 관리자의 다음 라운드 진행 또는 게임 종료 처리
async function proceedToNextStep(admin_round, room_number, user_submit_list, io, connection) {
    try {
        if (admin_round <= 32) {
            // 다음 라운드 타이머 설정
            make_room_timer(room_number, admin_round + 1, io, connection);
            console.log(`Timer set for room ${room_number}, next round: ${admin_round + 1}`);
        } else {
            // 게임 종료 처리
            console.log(`Ending game for room ${room_number}, final round reached`);

            // 사용자 상태 업데이트
            await connection.query('UPDATE users SET status=5 WHERE room=?', [room_number]);
            console.log(`All users in room ${room_number} updated to status 5`);

            // 사용자 상태 변경 알림 전송
            user_submit_list.forEach(user => {
                if (io.user_2_socket_id[user.id]) {
                    io.message(io.user_2_socket_id[user.id], 'change_user_status', { user_id: user.id, status: '5' });
                    console.log(`Status update message sent to user ID: ${user.id}`);
                } else {
                    console.warn(`Socket ID not found for user ID: ${user.id}`);
                }
            });

            // 방 상태 변경 알림 전송
            if (io.user_2_socket_id['admin']) {
                io.message(io.user_2_socket_id['admin'], 'change_room_round', { round: 'end', room_number: room_number });
                console.log(`End of game message sent to admin for room ${room_number}`);
            } else {
                console.warn('Admin socket ID not found');
            }

            // 게임 정보 업데이트
            await connection.query('UPDATE game_info SET room_status=3 WHERE room_id=?', [room_number]);
            console.log(`Room ${room_number} marked as ended in game_info`);
        }
    } catch (err) {
        console.error(`Error in proceedToNextStep for room ${room_number}, round ${admin_round}:`, err);
        throw err;
    }
}

// 각 사용자 상태 갱신 및 알림
async function updateWaitOtherForUsers(user_submit_list, io, connection) {
    try {
        // 모든 사용자의 상태 업데이트 및 알림 전송을 병렬로 처리
        await Promise.all(user_submit_list.map(async (user) => {
            try {
                // 사용자 상태 업데이트
                await connection.query('UPDATE users SET wait_other=0 WHERE id=?', [user.id]);
                console.log(`wait_other updated for user ID: ${user.id}`);

                // 사용자에게 상태 변경 알림 전송
                if (io.user_2_socket_id[user.id]) {
                    io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
                    console.log(`Status change notification sent to user ID: ${user.id}`);
                } else {
                    console.warn(`Socket ID not found for user ID: ${user.id}`);
                }
            } catch (userError) {
                console.error(`Error updating or notifying user ID: ${user.id}`, userError);
                throw userError;
            }
        }));
        console.log(`All users updated and notified successfully`);
    } catch (error) {
        console.error('Error in updateWaitOtherForUsers:', error);
        throw error; // 상위 함수로 에러 전달
    }
}

// 방 내 사용자 알림
async function notifyUsers(room_id, io, connection) {
    try {
        // 방 내 사용자 ID 가져오기
        const [users_in_room] = await connection.query('SELECT id FROM users WHERE room=?', [room_id]);

        if (!users_in_room || users_in_room.length === 0) {
            console.warn(`No users found in room ${room_id}`);
            return;
        }

        // 각 사용자에게 알림 전송
        await Promise.all(users_in_room.map(async (user) => {
            if (io.user_2_socket_id[user.id]) {
                io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
                console.log(`Notification sent to user ID: ${user.id}`);
            } else {
                console.warn(`Socket ID not found for user ID: ${user.id}`);
            }
        }));

        console.log(`All users in room ${room_id} notified successfully`);
    } catch (error) {
        console.error(`Error notifying users in room ${room_id}:`, error);
        throw error; // 상위 함수로 에러 전달
    }
}

// 관리자 게임 기록 추가
async function insertAdminGameRecord(admin_round, room_number, connection) {
    try {
        if (!Number.isInteger(admin_round) || admin_round <= 0) {
            throw new Error(`Invalid admin_round value: ${admin_round}`);
        }
        if (!room_number) {
            throw new Error(`Invalid room_number value: ${room_number}`);
        }

        await connection.query(
            "INSERT INTO game_record (round, id, room_id, start_time) VALUES (?, 'admin', ?, ?)",
            [admin_round, room_number, Date.now()]
        );
        console.log(`Admin game record inserted for room ${room_number}, round ${admin_round}`);
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            console.warn(`Duplicate admin game record for room ${room_number}, round ${admin_round}`);
        } else {
            console.error(`Error inserting admin game record for room ${room_number}, round ${admin_round}:`, err);
        }
        throw err; // 상위 함수로 에러 전달
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
