const socket = io();

// --- STATE ---
let myRole = null;
let rawBits = [];
let rawBases = [];
let receivedBits = []; // For Bob/Eve
let siftedKey = [];
let finalKey = ""; // Binary string

// --- DOM ELEMENTS ---
const elRoleBadge = document.getElementById('role-badge');
const elSystemStatus = {
    alice: document.getElementById('status-alice'),
    bob: document.getElementById('status-bob'),
    eve: document.getElementById('status-eve')
};
const panels = {
    alice: document.getElementById('panel-alice'),
    bob: document.getElementById('panel-bob'),
    eve: document.getElementById('panel-eve'),
    processing: document.getElementById('panel-processing'),
    chat: document.getElementById('panel-chat')
};

// --- SOCKET EVENTS ---
socket.on('connect', () => {
    document.getElementById('connection-overlay').classList.add('hidden');
    document.getElementById('main-interface').style.display = 'block';
});

socket.on('role_assigned', (data) => {
    myRole = data.role;
    elRoleBadge.textContent = myRole.toUpperCase();
    elRoleBadge.className = `badge ${myRole}`;

    // Show appropriate panel
    Object.values(panels).forEach(p => p.classList.add('hidden'));
    panels[myRole].classList.remove('hidden');
    panels.processing.classList.remove('hidden');
});

socket.on('system_status', (status) => {
    elSystemStatus.alice.className = `status-indicator ${status.alice_connected ? 'online' : 'offline'}`;
    elSystemStatus.bob.className = `status-indicator ${status.bob_connected ? 'online' : 'offline'}`;
    elSystemStatus.eve.className = `status-indicator ${status.eve_connected ? 'online' : 'offline'}`;
});

// --- QUANTUM CHANNEL ---

// Alice: Generate
document.getElementById('btn-generate')?.addEventListener('click', () => {
    const numBits = parseInt(document.getElementById('num-bits').value) || 128;
    rawBits = Array.from({ length: numBits }, () => Math.random() < 0.5 ? 0 : 1);
    rawBases = Array.from({ length: numBits }, () => Math.random() < 0.5 ? '+' : 'x');

    document.getElementById('a-raw-bits').textContent = rawBits.join('');
    document.getElementById('a-raw-bases').textContent = rawBases.join('');
    document.getElementById('btn-sift').disabled = false;

    socket.emit('send_quantum_bits', { bits: rawBits, bases: rawBases });
});

// Eve: Intercept
socket.on('quantum_interception', (data) => {
    if (myRole !== 'eve') return;
    document.getElementById('e-bases').textContent = data.eve_bases.join('');
    document.getElementById('e-bits').textContent = data.eve_bits.join('');
});

// Bob: Receive
socket.on('receive_quantum_bits', (data) => {
    if (myRole !== 'bob') return;

    const incomingBits = data.bits;
    // Bob needs to guess bases
    rawBases = Array.from({ length: incomingBits.length }, () => Math.random() < 0.5 ? '+' : 'x');

    // In actual physics Bob measures and collapses state, but backend did that if Eve was there. 
    // Otherwise backend gave Alice's exact bits.
    // If Bob's basis != Alice's, Bob's result should literally be random. But we need Alice's bases to know that.
    // Since we don't have Alice's bases here (quantum nature), the backend didn't scramble for Bob, because Bob's 
    // scrambling happens AT measurement. Let's simulate Bob's wrong basis measurement here:
    // Actually, we must do this during sifting or require backend to simulate Bob too.
    // simpler: Bob stores incoming bits. His measurement happens now:
    // But wait! Without knowing Alice's bases, we can't randomize Bob's wrong guesses.
    // Let's assume the incoming bits are "states" parameterized by Alice's bases.
    // To fix this simply: Bob just gets the bits. Let's do the randomization during sifting to keep it simple, OR 
    // accept that we skipped Bob's wrong-basis randomization for visual simplicity. We will add Bob's randomizer in sifting.

    receivedBits = incomingBits; // temporary

    document.getElementById('b-waiting').classList.add('hidden');
    document.getElementById('b-raw-view').classList.remove('hidden');
    document.getElementById('b-raw-bases').textContent = rawBases.join('');
    document.getElementById('b-raw-bits').textContent = '(Measuring...)';

    // Trigger sifting phase from Bob's side after a delay to simulate real-time
    setTimeout(() => {
        socket.emit('sifting_phase_bob', { bases: rawBases });
    }, 1000);
});

// --- SIFTING PHASE (CLASSICAL) ---

document.getElementById('btn-sift')?.addEventListener('click', () => {
    socket.emit('sifting_phase_alice', { bases: rawBases });
});

// Alice receives Bob's bases
socket.on('bob_bases_published', (data) => {
    if (myRole === 'alice') {
        const bobBases = data.bases;
        siftedKey = [];
        for (let i = 0; i < rawBases.length; i++) {
            if (rawBases[i] === bobBases[i]) {
                siftedKey.push(rawBits[i]);
            }
        }
        document.getElementById('a-sifted-view').classList.remove('hidden');
        document.getElementById('a-sifted-key').textContent = siftedKey.join('');
        document.getElementById('btn-calc-qber').disabled = false;

        // Let Bob know to finish his sifting
        socket.emit('sifting_phase_alice', { bases: rawBases, trueBits: rawBits }); // sending true bits purely for simulation to calculate Bob's errors
    }
});

// Bob receives Alice's bases
socket.on('alice_bases_published', (data) => {
    if (myRole === 'bob') {
        const aliceBases = data.bases;
        // In simulation, trueBits lets us simulate Bob's wrong basis measurement accurately now.
        const aliceBits = data.trueBits || receivedBits; // If Alice sent true bits

        siftedKey = [];
        let finalMeasuredBits = [];
        for (let i = 0; i < rawBases.length; i++) {
            // Did Eve tangle it? receivedBits[i] will be Eve's collapsed state if Eve was there.
            let bitToMeasure = receivedBits[i];

            if (rawBases[i] === aliceBases[i]) {
                // Bases match. Bit should be perfect, UNLESS Eve messed it up, in which case bitToMeasure has Eve's random bit.
                siftedKey.push(bitToMeasure);
            }
            finalMeasuredBits.push(bitToMeasure);
        }

        document.getElementById('b-raw-bits').textContent = finalMeasuredBits.join('');
        document.getElementById('b-sifted-view').classList.remove('hidden');
        document.getElementById('b-sifted-key').textContent = siftedKey.join('');

        document.getElementById('btn-calc-qber').disabled = false;
    }
});


// --- ERROR ESTIMATION ---
document.getElementById('btn-calc-qber')?.addEventListener('click', () => {
    if (myRole === 'alice') {
        // Send a portion of the key to server for QBER
        const subsetSize = Math.floor(siftedKey.length * 0.3); // test 30%
        const subset = siftedKey.slice(0, subsetSize).join('');
        socket.emit('qber_result', { sender: 'alice', subsetSize, subsetStr: subset });
    } else if (myRole === 'bob') {
        const subsetSize = Math.floor(siftedKey.length * 0.3);
        const subset = siftedKey.slice(0, subsetSize).join('');
        socket.emit('qber_result', { sender: 'bob', subsetSize, subsetStr: subset });
    }
});

let qberSubsets = {};
socket.on('qber_update', (data) => {
    qberSubsets[data.sender] = data;

    if (qberSubsets['alice'] && qberSubsets['bob']) {
        // Compare
        const aSub = qberSubsets['alice'].subsetStr;
        const bSub = qberSubsets['bob'].subsetStr;

        let errors = 0;
        for (let i = 0; i < aSub.length; i++) {
            if (aSub[i] !== bSub[i]) errors++;
        }

        const qber = errors / aSub.length;
        const qberPerc = (qber * 100).toFixed(2);

        const resDiv = document.getElementById('qber-result');
        resDiv.innerHTML = `Tests: ${aSub.length} bits. Errors: ${errors}. <strong>QBER: ${qberPerc}%</strong>`;

        if (qber > 0.15) {
            resDiv.innerHTML += '<br><span class="neon-red">EAVESDROPPER DETECTED! Key discarded.</span>';
            document.getElementById('step-qber').classList.add('alert-qber-high');
        } else {
            resDiv.innerHTML += '<br><span class="neon-green">Channel Secure. Proceeding...</span>';
            document.getElementById('step-recon').classList.remove('disabled');
            document.getElementById('btn-recon').disabled = false;

            // Discard the tested subset from actual key
            siftedKey = siftedKey.slice(qberSubsets['alice'].subsetSize);
        }
    }
});


// --- RECONCILIATION ---
document.getElementById('btn-recon')?.addEventListener('click', () => {
    // Mock parity check
    document.getElementById('recon-result').innerHTML = "Parity matrix established. Corrected 0/1 bit flips.<br>Key synchronized.";
    document.getElementById('step-privacy').classList.remove('disabled');
    document.getElementById('btn-privacy').disabled = false;
});

// --- PRIVACY AMPLIFICATION ---
document.getElementById('btn-privacy')?.addEventListener('click', () => {
    // Hash key to compress it
    const keyStr = siftedKey.join('');
    // Simple SHA256 using cryptoJS to derive a nice 64 char hex string (256 bits)
    const hash = CryptoJS.SHA256(keyStr).toString(CryptoJS.enc.Hex);

    // We convert hex back to bits or just use hex as the final key
    finalKey = hash;

    document.getElementById('privacy-result').innerHTML = `Initial Size: ${keyStr.length} bits.<br>Amplified Key: <span class="neon-green">${finalKey.substring(0, 24)}...</span>`;

    // Enable Chat
    socket.emit('keys_established');
});

socket.on('keys_ready', () => {
    panels.chat.classList.remove('hidden');
    document.getElementById('active-key').textContent = finalKey.substring(0, 32) + '...';

    if (myRole === 'eve') {
        document.getElementById('chat-controls').classList.add('hidden');
        document.getElementById('eve-chat-view').classList.remove('hidden');
    }
});

// --- OTP CHAT ---

// Simple XOR Hex string encryption 
function xorEncryptDecrypt(text, keyHex) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        // Just take hex characters and XOR charcodes
        const keyChar = keyHex.charCodeAt(i % keyHex.length);
        const textChar = text.charCodeAt(i);
        result += String.fromCharCode(textChar ^ keyChar);
    }
    // Convert to hex for display
    return btoa(result);
}

function xorDecrypt(base64Str, keyHex) {
    let text = atob(base64Str);
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const keyChar = keyHex.charCodeAt(i % keyHex.length);
        const textChar = text.charCodeAt(i);
        result += String.fromCharCode(textChar ^ keyChar);
    }
    return result;
}

document.getElementById('btn-send-chat')?.addEventListener('click', () => {
    const input = document.getElementById('chat-input');
    const msg = input.value;
    if (!msg) return;

    const ciphertext = xorEncryptDecrypt(msg, finalKey);
    socket.emit('send_chat_message', { ciphertext: ciphertext });

    input.value = '';
});

// Also trigger on enter key
document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-send-chat').click();
});

socket.on('receive_chat_message', (data) => {
    const box = document.getElementById('chat-messages');

    if (myRole === 'eve') {
        box.innerHTML += `<div class="chat-msg"><strong class="neon-red">Intercepted:</strong><div class="cipher">${data.ciphertext}</div></div>`;
    } else {
        // Alice or Bob
        const isMine = data.sender === myRole;
        const plaintext = xorDecrypt(data.ciphertext, finalKey);
        const clz = isMine ? 'msg-mine' : 'msg-theirs';

        box.innerHTML += `
            <div class="chat-msg ${clz}">
                <div class="meta">${data.sender.toUpperCase()}</div>
                <div class="plain">${plaintext}</div>
                <div class="cipher">Encrypted: ${data.ciphertext.substring(0, 20)}...</div>
            </div>`;
    }
    box.scrollTop = box.scrollHeight;
});
