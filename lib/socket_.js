var socket_io = require('socket.io');

var socket_ = (function() {

    var io = socket_io();
    var user_2_socket_id = {}
    var socket_id_2_user = {}

    var message = function(user_id, event, data) {
        io.sockets.to(user_id).emit(event, data);
    }

    io.on('connection', function(socket) {
        
        // 유저 접속 시 key 와 아이디 저장
        socket.on('user_connected', function(received_user_id) {
            console.log('user connected', received_user_id);
            user_2_socket_id[received_user_id] = socket.id;
            socket_id_2_user[socket.id] = received_user_id;
            socket.join(socket_id_2_user[socket.id]);
        });

        // 유저 나가면 key 삭제
        socket.on('disconnect', function() {
            try {
                delete user_2_socket_id[socket_id_2_user[socket.id]];
                delete socket_id_2_user[socket.id];
            }
            catch (e) {
                console.log(e);
            }
            socket.leave(socket_id_2_user[socket.id]);
        });
        
    });

    // public attribute, method
    return {
        io: io,
        user_2_socket_id: user_2_socket_id,
        socket_id_2_user: socket_id_2_user,
        message:message
    };
    
}());

module.exports = socket_;