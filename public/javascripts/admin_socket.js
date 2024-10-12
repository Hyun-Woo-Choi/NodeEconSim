var socket = io();

var admin_socket = (function() {

    var connect_user = function(user_id) {
        socket.emit('user_connected', user_id);
    }

    // public attribute, method
    return {
        connect_user: connect_user
    };
    
}());

socket.on('duplicate_login', function(msg) {
    alert("duplicate loing, ask administrator" + msg);
    document.location.href = "/session_destroy_as_duplicate";
});

socket.on('change_user_status', function(data) {
    if (data.status === '1')
        $('#status'+data.user_id).text('wait');
    else if (data.status === '2')
        $('#status'+data.user_id).text('ready');
    else if (data.status === '3')
        $('#status'+data.user_id).text('start');
    else if (data.status === '5')
        $('#status'+data.user_id).text('end');
    // else
    //     $('#status'+data.user_id).text(data.status);
});

socket.on('change_room_round', function(data) {
    $('#round'+data.room_number).text(data.round);
    if (data.round == 'end')
        $('#stop'+data.room_number).prop('disabled', true);
});