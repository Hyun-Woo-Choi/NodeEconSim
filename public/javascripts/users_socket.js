var socket = io();

var users_socket = (function() {

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

socket.on('reload_as_status_change', function(msg) {
    location.reload();
});