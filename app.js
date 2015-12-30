var express = require("express");
var bodyParser = require("body-parser");
var app = express();
var http = require("http").Server(app);
var io = require("socket.io")(http);
var SOCKET_IO_PORT = 3001;

// Pending names are mapped to null.
var nameToSocketIdMap = {}

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static("public"));

app.get("/", function(request, result) {
    result.sendFile("index.html", { root: "./public" });
});

app.get("/join", function(request, result) {
    var requestedName = String(request.query.name).trim();
    if (requestedName in nameToSocketIdMap) {
        result.json({
            success: false,
            port: SOCKET_IO_PORT
        });
        return;
    }

    nameToSocketIdMap[requestedName] = null;
    result.json({
        success: true,
        port: SOCKET_IO_PORT
    });
});

app.get("/main", function(request, result) {
    result.sendFile("main.html", { root: "./public" });
});

io.listen(SOCKET_IO_PORT);

// Server-side handshaking.
io.on("connection", function(socket) {
    socket.on("disconnect", function() {
        for (var name in nameToSocketIdMap) {
            if (nameToSocketIdMap[name] !== socket.id)
                continue;

            nameToSocketIdMap[name] = null;
            setTimeout(function() {
                // If the client refreshes, don't remove the client immediately.
                // Instead, set a timer for the client to reconnect.
                if (nameToSocketIdMap[name] == null)
                    delete nameToSocketIdMap[name]
            }, 5000);
        }
    });

    socket.on("client_broadcasted_roll", function(objStr) {

        var parsedObject;
        try {
            parsedObject = JSON.parse(objStr);
        } catch (e) {
            return;
        }

        var name = parsedObject.userName;
        var result = parsedObject.result;
        if (!(name in nameToSocketIdMap) || parsedObject.rollName == null)
            return;

        if (!result || typeof(result) !== "object" || result.length == 0)
            return;

        var senderId = nameToSocketIdMap[name];
        for (var receiverName in nameToSocketIdMap) {
            var receiverId = nameToSocketIdMap[receiverName];
            if (receiverId === senderId || !receiverId)
                continue;

            io.to(receiverId).emit("server_notify_roll", objStr);
        }
    });

    socket.on("client_name_response", function(name) {
        nameToSocketIdMap[name] = socket.id;
        io.emit("server_handshaking_complete", name);
    });

    socket.emit("server_request_name");
});


module.exports = app;
