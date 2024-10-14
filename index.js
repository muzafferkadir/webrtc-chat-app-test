require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname)));

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/myapp',
  allow_discovery: true
});

app.use('/peerjs', peerServer);

// In-memory veritabanı
const groups = new Map();
const users = new Map();

// add test group
groups.set('test', { id: 'test', name: 'test', members: [], messages: [] });

// Socket.IO işlemleri
io.on('connection', (socket) => {
    console.log('Yeni kullanıcı bağlandı');

    socket.on('register', (username) => {
        users.set(socket.id, { id: socket.id, username });
        socket.emit('registered', { id: socket.id, username });
    });

    socket.on('createGroup', (groupName) => {
        const group = { id: groupName, groupName, name: groupName, members: [socket.id], messages: [] };
        groups.set(group.name, group);

        socket.join(group.name);
        socket.emit('groupCreated', group);
    });

    socket.on('joinGroup', (groupId) => {
        const group = groups.get(groupId);
        if (group) {
            group.members.push(socket.id);
            socket.join(groupId);
            socket.emit('joinedGroup', group);
        }
    });

    socket.on('sendMessage', ({ groupId, message }) => {
        const group = groups.get(groupId);
        if (group) {
            const user = users.get(socket.id);
            const newMessage = { id: Date.now().toString(), userId: socket.id, username: user.username, text: message };
            group.messages.push(newMessage);
            io.to(groupId).emit('newMessage', newMessage);
        }
    });

    // Sesli sohbet için yeni bir olay ekleyin
    socket.on('joinVoiceChat', (groupId) => {
        const group = groups.get(groupId);
        if (group) {
            socket.join(`voice-${groupId}`);
            io.to(`voice-${groupId}`).emit('userJoinedVoice', socket.id);
        }
    });

    socket.on('leaveVoiceChat', (groupId) => {
        socket.leave(`voice-${groupId}`);
        io.to(`voice-${groupId}`).emit('userLeftVoice', socket.id);
    });

    socket.on('disconnect', () => {
        users.delete(socket.id);
        groups.forEach((group) => {
            group.members = group.members.filter(memberId => memberId !== socket.id);
        });
    });
});

// HTML sayfası
const html = `
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat Uygulaması</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f0f0f0;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 5px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            text-align: center;
        }
        input, button {
            width: 100%;
            padding: 10px;
            margin: 10px 0;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        button {
            background-color: #4CAF50;
            color: white;
            border: none;
            cursor: pointer;
        }
        button:hover {
            background-color: #45a049;
        }
        #messages {
            height: 300px;
            overflow-y: scroll;
            border: 1px solid #ddd;
            padding: 10px;
            margin-top: 20px;
        }
        #videoContainer {
            display: flex;
            justify-content: space-around;
            margin-top: 20px;
        }
        video {
            width: 300px;
            height: 225px;
            background-color: #ddd;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Chat Uygulaması</h1>
        <div id="login">
            <input type="text" id="username" value="User 1" placeholder="Kullanıcı adı">
            <button onclick="register()">Giriş Yap</button>
        </div>
        <div id="groupActions" style="display:none;">
            <input type="text" id="groupName" value="Grup 1" placeholder="Grup adı">
            <button onclick="createGroup()">Grup Oluştur</button>
            <input type="text" id="groupId" value="test" placeholder="Grup ID">
            <button onclick="joinGroup()">Gruba Katıl</button>
        </div>
        <div id="chat" style="display:none;">
            <h2 id="groupTitle"></h2>
            <div id="messages"></div>
            <input type="text" id="message" placeholder="Mesajınız">
            <button onclick="sendMessage()">Gönder</button>
            <button onclick="toggleVoiceChat()">Sesli Sohbeti Aç/Kapat</button>
            <button onclick="toggleMicrophone()" id="microphoneButton">Mikrofonu Aç/Kapat</button>
            <button onclick="toggleVideoChat()">Görüntülü Sohbeti Aç/Kapat</button>
            <button onclick="toggleCamera()" id="cameraButton">Kamerayı Aç/Kapat</button>
            <div id="videoContainer">
                <video id="localVideo" autoplay muted></video>
                <video id="remoteVideo" autoplay></video>
            </div>
        </div>
    </div>

    <script src="https://unpkg.com/peerjs@1.4.7/dist/peerjs.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let currentUser = null;
        let currentGroup = null;
        let peer = null;
        let localStream = null;
        let calls = {};
        let inVoiceChat = false;
        let isMicrophoneActive = true;
        let audioContext;
        let noiseReducer;
        let videoStream = null;
        let isCameraActive = false;

        socket.on('registered', (user) => {
            currentUser = user;
            document.getElementById('login').style.display = 'none';
            document.getElementById('groupActions').style.display = 'block';
        });

        socket.on('groupCreated', (group) => {
            currentGroup = group;
            showChat();
        });

        socket.on('joinedGroup', (group) => {
            currentGroup = group;
            showChat();
        });

        socket.on('newMessage', (message) => {
            const messagesDiv = document.getElementById('messages');
            messagesDiv.innerHTML += \`<p><strong>\${message.username}:</strong> \${message.text}</p>\`;
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });

        function register() {
            const username = document.getElementById('username').value;
            socket.emit('register', username);
        }

        function createGroup() {
            const groupName = document.getElementById('groupName').value;
            socket.emit('createGroup', groupName);
        }

        function joinGroup() {
            const groupId = document.getElementById('groupId').value;
            socket.emit('joinGroup', groupId);
        }

        function showChat() {
            document.getElementById('groupActions').style.display = 'none';
            document.getElementById('chat').style.display = 'block';
            document.getElementById('groupTitle').textContent = currentGroup.name;
        }

        function sendMessage() {
            const message = document.getElementById('message').value;
            socket.emit('sendMessage', { groupId: currentGroup.id, message });
            document.getElementById('message').value = '';
        }

        async function toggleVoiceChat() {
            if (inVoiceChat) {
                leaveVoiceChat();
            } else {
                joinVoiceChat();
            }
        }

        async function joinVoiceChat() {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                // Gürültü azaltma işlemi
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = audioContext.createMediaStreamSource(localStream);
                noiseReducer = audioContext.createDynamicsCompressor();
                noiseReducer.threshold.value = -50;
                noiseReducer.knee.value = 40;
                noiseReducer.ratio.value = 12;
                noiseReducer.attack.value = 0;
                noiseReducer.release.value = 0.25;
                source.connect(noiseReducer);
                const destination = audioContext.createMediaStreamDestination();
                noiseReducer.connect(destination);
                localStream = destination.stream;

                peer = new Peer(socket.id, {
                    host: '${process.env.BROADCAST_HOST}',
                    port: '${process.env.BROADCAST_PORT}',
                    path: '/peerjs/myapp',
                    secure: true,
                });

                peer.on('open', (id) => {
                    console.log('My peer ID is: ' + id);
                    socket.emit('joinVoiceChat', currentGroup.id);
                    inVoiceChat = true;
                });

                peer.on('error', (err) => {
                    console.error('Peer bağlantı hatası:', err);
                });

                peer.on('call', (call) => {
                    call.answer(localStream);
                    call.on('stream', (remoteStream) => {
                        // Uzak ses akışını oynatmak için gerekli işlemleri yapın
                        const audio = new Audio();
                        audio.srcObject = remoteStream;
                        audio.play();
                    });
                    calls[call.peer] = call;
                });

                socket.on('userJoinedVoice', (userId) => {
                    if (userId !== socket.id) {
                        const call = peer.call(userId, localStream);
                        call.on('stream', (remoteStream) => {
                            // Uzak ses akışını oynatmak için gerekli işlemleri yapın
                            const audio = new Audio();
                            audio.srcObject = remoteStream;
                            audio.play();
                        });
                        calls[userId] = call;
                    }
                });

                socket.on('userLeftVoice', (userId) => {
                    if (calls[userId]) {
                        calls[userId].close();
                        delete calls[userId];
                    }
                });

            } catch (error) {
                console.error('Sesli sohbete katılma hatası:', error);
            }
        }

        function leaveVoiceChat() {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
            if (audioContext) {
                audioContext.close();
            }
            if (peer) {
                peer.destroy();
            }
            Object.values(calls).forEach(call => call.close());
            calls = {};
            socket.emit('leaveVoiceChat', currentGroup.id);
            inVoiceChat = false;
        }

        function toggleMicrophone() {
            if (localStream) {
                const audioTrack = localStream.getAudioTracks()[0];
                if (audioTrack) {
                    isMicrophoneActive = !isMicrophoneActive;
                    audioTrack.enabled = isMicrophoneActive;
                    document.getElementById('microphoneButton').textContent = isMicrophoneActive ? 'Mikrofonu Kapat' : 'Mikrofonu Aç';
                }
            }
        }

        async function toggleVideoChat() {
            if (inVoiceChat) {
                leaveVideoChat();
            } else {
                joinVideoChat();
            }
        }

        async function joinVideoChat() {
            try {
                videoStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                localStream = videoStream;
                
                document.getElementById('localVideo').srcObject = videoStream;

                peer = new Peer(socket.id, {
                    host: '${process.env.BROADCAST_HOST}',
                    port: '${process.env.BROADCAST_PORT}',
                    path: '/peerjs/myapp',
                    secure: true,
                });

                peer.on('open', (id) => {
                    console.log('My peer ID is: ' + id);
                    socket.emit('joinVoiceChat', currentGroup.id);
                    inVoiceChat = true;
                });

                peer.on('error', (err) => {
                    console.error('Peer bağlantı hatası:', err);
                });

                peer.on('call', (call) => {
                    call.answer(videoStream);
                    call.on('stream', (remoteStream) => {
                        document.getElementById('remoteVideo').srcObject = remoteStream;
                    });
                    calls[call.peer] = call;
                });

                socket.on('userJoinedVoice', (userId) => {
                    if (userId !== socket.id) {
                        const call = peer.call(userId, videoStream);
                        call.on('stream', (remoteStream) => {
                            document.getElementById('remoteVideo').srcObject = remoteStream;
                        });
                        calls[userId] = call;
                    }
                });

                socket.on('userLeftVoice', (userId) => {
                    if (calls[userId]) {
                        calls[userId].close();
                        delete calls[userId];
                    }
                    document.getElementById('remoteVideo').srcObject = null;
                });

                isCameraActive = true;
                document.getElementById('cameraButton').textContent = 'Kamerayı Kapat';

            } catch (error) {
                console.error('Görüntülü sohbete katılma hatası:', error);
            }
        }

        function leaveVideoChat() {
            if (videoStream) {
                videoStream.getTracks().forEach(track => track.stop());
            }
            if (peer) {
                peer.destroy();
            }
            Object.values(calls).forEach(call => call.close());
            calls = {};
            socket.emit('leaveVoiceChat', currentGroup.id);
            inVoiceChat = false;
            document.getElementById('localVideo').srcObject = null;
            document.getElementById('remoteVideo').srcObject = null;
            isCameraActive = false;
            document.getElementById('cameraButton').textContent = 'Kamerayı Aç';
        }

        function toggleCamera() {
            if (videoStream) {
                const videoTrack = videoStream.getVideoTracks()[0];
                if (videoTrack) {
                    isCameraActive = !isCameraActive;
                    videoTrack.enabled = isCameraActive;
                    document.getElementById('cameraButton').textContent = isCameraActive ? 'Kamerayı Kapat' : 'Kamerayı Aç';
                }
            }
        }
    </script>
</body>
</html>`;

// Ana route
app.get('/', (req, res) => {
    res.send(html);
});

// Sunucuyu başlat
const PORT = process.env.APP_PORT;
const HOST = process.env.APP_HOST;
server.listen(PORT, HOST, () => console.log(`Server running on https://${HOST}:${PORT}`));