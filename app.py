import random
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, disconnect

app = Flask(__name__)
app.config['SECRET_KEY'] = 'bb84_quantum_secret'
socketio = SocketIO(app, cors_allowed_origins="*")

# State management
clients = {
    'alice': None,
    'bob': None,
    'eve': None
}
# Map sid -> role
user_roles = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    global clients, user_roles
    sid = request.sid
    
    # Assign roles based on connection order
    role = None
    if clients['alice'] is None:
        role = 'alice'
        clients['alice'] = sid
    elif clients['bob'] is None:
        role = 'bob'
        clients['bob'] = sid
    else:
        # 3rd and subsequent connections become Eve
        role = 'eve'
        clients['eve'] = sid # Overwrite if multiple Eves, keep the latest one for simplicity
        
    user_roles[sid] = role
    emit('role_assigned', {'role': role}, to=sid)
    print(f"Client {sid} connected and assigned role: {role}")
    
    # Broadcast current user status
    broadcast_status()

@socketio.on('disconnect')
def handle_disconnect():
    global clients, user_roles
    sid = request.sid
    role = user_roles.get(sid)
    
    if role:
        if role == 'eve':
            if clients['eve'] == sid:
                clients['eve'] = None
        else:
            clients[role] = None
        del user_roles[sid]
        print(f"Client {sid} (Role: {role}) disconnected.")
        broadcast_status()

def broadcast_status():
    status = {
        'alice_connected': clients['alice'] is not None,
        'bob_connected': clients['bob'] is not None,
        'eve_connected': clients['eve'] is not None
    }
    socketio.emit('system_status', status)

# --- 1. The Quantum Channel ---
@socketio.on('send_quantum_bits')
def handle_quantum_transmission(data):
    """
    Alice sends her raw bits and bases.
    If Eve is present, Eve measures them first (intercept and resend).
    Else, Bob gets them unaltered.
    """
    sid = request.sid
    if user_roles.get(sid) != 'alice':
        return
        
    alice_bits = data.get('bits', [])
    alice_bases = data.get('bases', [])
    
    # If Eve is connected, Eve intercepts the transmission
    if clients['eve'] is not None:
        eve_bases = []
        eve_bits = []
        bob_received_bits = []
        
        # Eve randomly chooses bases to measure
        for i in range(len(alice_bits)):
            e_base = '+' if random.random() < 0.5 else 'x'
            eve_bases.append(e_base)
            
            # Measurement collapse
            if e_base == alice_bases[i]:
                # Correct basis, Eve reads the bit perfectly
                eve_bits.append(alice_bits[i])
                bob_received_bits.append(alice_bits[i])
            else:
                # Wrong basis, state collapses. Bit becomes completely random 0 or 1
                random_bit = random.choice([0, 1])
                eve_bits.append(random_bit)
                # Eve must pass this new randomized state to Bob because the original state was destroyed
                bob_received_bits.append(random_bit)
                
        # Send interception info to Eve's dashboard
        socketio.emit('quantum_interception', {
            'alice_bits': alice_bits, # Normally she doesn't know this, but for simulation UI we might want it. Let's send only what Eve sees.
            'eve_bases': eve_bases,
            'eve_bits': eve_bits
        }, to=clients['eve'])
        
        # Bob receives the collapsed/altered states
        if clients['bob']:
            socketio.emit('receive_quantum_bits', {'bits': bob_received_bits}, to=clients['bob'])
            
    else:
        # No Eve -> Bob receives Alice's bits perfectly
        if clients['bob']:
            socketio.emit('receive_quantum_bits', {'bits': alice_bits}, to=clients['bob'])


# --- 2. The Classical Channel & BB84 Steps ---

@socketio.on('sifting_phase_alice')
def handle_sifting_alice(data):
    """Alice broadcasts her bases classically."""
    if user_roles.get(request.sid) != 'alice': return
    socketio.emit('alice_bases_published', {'bases': data['bases']})

@socketio.on('sifting_phase_bob')
def handle_sifting_bob(data):
    """Bob broadcasts his bases classically."""
    if user_roles.get(request.sid) != 'bob': return
    socketio.emit('bob_bases_published', {'bases': data['bases']})


@socketio.on('error_estimation')
def handle_error_estimation(data):
    """
    Alice exposes a random subset of her sifted key bits.
    Bob replies if they match.
    In our simulation, we can just let the frontend calculate QBER and broadcast it.
    """
    pass

@socketio.on('qber_result')
def handle_qber_result(data):
    """Broadcasts QBER to all for UI updates."""
    socketio.emit('qber_update', data)

@socketio.on('keys_established')
def handle_keys_established(data):
    """Notify system that secure keys are ready"""
    socketio.emit('keys_ready', broadcast=True)

# --- OTP Chat Channel ---
@socketio.on('send_chat_message')
def handle_chat_message(data):
    sender_role = user_roles.get(request.sid)
    ciphertext = data.get('ciphertext')
    
    msg_payload = {
        'sender': sender_role,
        'ciphertext': ciphertext
    }
    # Broadcast ciphertext to everyone on the classical channel
    socketio.emit('receive_chat_message', msg_payload)

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5001, allow_unsafe_werkzeug=True)
