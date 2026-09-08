use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket},
    time::SystemTime,
    time::{Duration, Instant},
};

use serde::Deserialize;

#[derive(Debug, Default)]
pub struct PingPlayers {
    pub online: u32,
    pub max: u32,
    pub sample: Vec<String>,
    pub latency_ms: u32,
    pub server_name: Option<String>,
    pub version: Option<String>,
}

const RAKNET_MAGIC: [u8; 16] = [
    0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe, 0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78,
];
const MAX_BEDROCK_PONG_BYTES: usize = 65_535;

#[derive(Debug, Deserialize)]
struct StatusResponse {
    players: Option<StatusPlayers>,
}

#[derive(Debug, Deserialize)]
struct StatusPlayers {
    online: u32,
    max: u32,
    sample: Option<Vec<StatusPlayerSample>>,
}

#[derive(Debug, Deserialize)]
struct StatusPlayerSample {
    name: String,
}

pub fn ping_local_server(port: u16) -> Option<PingPlayers> {
    let started = Instant::now();
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(500)).ok()?;
    stream
        .set_read_timeout(Some(Duration::from_millis(800)))
        .ok()?;
    stream
        .set_write_timeout(Some(Duration::from_millis(800)))
        .ok()?;

    let mut handshake = Vec::new();
    write_varint(&mut handshake, 0);
    write_varint(&mut handshake, 769);
    write_string(&mut handshake, "localhost");
    handshake.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut handshake, 1);
    write_packet(&mut stream, &handshake).ok()?;

    write_packet(&mut stream, &[0]).ok()?;
    let _packet_length = read_varint(&mut stream).ok()?;
    let packet_id = read_varint(&mut stream).ok()?;
    if packet_id != 0 {
        return None;
    }
    let json_length = read_varint(&mut stream).ok()? as usize;
    if json_length > 1_048_576 {
        return None;
    }
    let mut json = vec![0; json_length];
    stream.read_exact(&mut json).ok()?;
    let response: StatusResponse = serde_json::from_slice(&json).ok()?;
    let players = response.players?;
    Some(PingPlayers {
        online: players.online,
        max: players.max,
        sample: players
            .sample
            .unwrap_or_default()
            .into_iter()
            .map(|player| player.name)
            .filter(|name| {
                !name.is_empty() && name.len() <= 64 && !name.chars().any(char::is_control)
            })
            .collect(),
        latency_ms: started.elapsed().as_millis().min(u32::MAX as u128) as u32,
        server_name: None,
        version: None,
    })
}

/// Pings a local native Bedrock Dedicated Server through its UDP/RakNet status
/// endpoint. This never sends a gameplay login or credentials.
pub fn ping_bedrock_server(port: u16) -> Option<PingPlayers> {
    ping_bedrock_endpoint("127.0.0.1", port)
}

/// Pings a Bedrock UDP endpoint. Callers should only pass an endpoint explicitly
/// chosen for Minecraft diagnostics; this is not a general network scanner.
pub fn ping_bedrock_endpoint(host: &str, port: u16) -> Option<PingPlayers> {
    let addresses = (host, port).to_socket_addrs().ok()?;
    for address in addresses {
        if let Some(status) = ping_bedrock_address(address) {
            return Some(status);
        }
    }
    None
}

fn ping_bedrock_address(address: SocketAddr) -> Option<PingPlayers> {
    let bind_address = if address.is_ipv4() {
        SocketAddr::from(([0, 0, 0, 0], 0))
    } else {
        "[::]:0".parse().ok()?
    };
    let socket = UdpSocket::bind(bind_address).ok()?;
    socket
        .set_read_timeout(Some(Duration::from_millis(900)))
        .ok()?;
    socket
        .set_write_timeout(Some(Duration::from_millis(900)))
        .ok()?;
    socket.connect(address).ok()?;

    let started = Instant::now();
    let timestamp = SystemTime::UNIX_EPOCH
        .elapsed()
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64;
    let client_guid = timestamp.rotate_left(17) ^ u64::from(std::process::id());
    let mut request = Vec::with_capacity(33);
    request.push(0x01); // RakNet Unconnected Ping
    request.extend_from_slice(&timestamp.to_be_bytes());
    request.extend_from_slice(&RAKNET_MAGIC);
    request.extend_from_slice(&client_guid.to_be_bytes());
    socket.send(&request).ok()?;

    let mut response = [0u8; MAX_BEDROCK_PONG_BYTES];
    let received = socket.recv(&mut response).ok()?;
    let mut status = parse_bedrock_pong(&response[..received])?;
    status.latency_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
    Some(status)
}

fn parse_bedrock_pong(packet: &[u8]) -> Option<PingPlayers> {
    // ID + echoed time + server GUID + magic + UTF-8 string length.
    if packet.len() < 35 || packet[0] != 0x1c || packet[17..33] != RAKNET_MAGIC {
        return None;
    }
    let motd_length = u16::from_be_bytes([packet[33], packet[34]]) as usize;
    if motd_length == 0 || motd_length > MAX_BEDROCK_PONG_BYTES - 35 {
        return None;
    }
    let end = 35usize.checked_add(motd_length)?;
    if end > packet.len() {
        return None;
    }
    let motd = std::str::from_utf8(&packet[35..end]).ok()?;
    let fields = motd.split(';').collect::<Vec<_>>();
    if fields.first().copied() != Some("MCPE") || fields.len() < 6 {
        return None;
    }
    let online = fields[4].parse::<u32>().ok()?;
    let max = fields[5].parse::<u32>().ok()?;
    if online > max {
        return None;
    }
    Some(PingPlayers {
        online,
        max,
        sample: Vec::new(),
        latency_ms: 0,
        server_name: non_empty(fields[1]),
        version: non_empty(fields[3]),
    })
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn write_packet(stream: &mut TcpStream, payload: &[u8]) -> std::io::Result<()> {
    let mut packet = Vec::new();
    write_varint(&mut packet, payload.len() as i32);
    packet.extend_from_slice(payload);
    stream.write_all(&packet)
}

fn write_string(output: &mut Vec<u8>, value: &str) {
    write_varint(output, value.len() as i32);
    output.extend_from_slice(value.as_bytes());
}

fn write_varint(output: &mut Vec<u8>, mut value: i32) {
    loop {
        if value & !0x7f == 0 {
            output.push(value as u8);
            return;
        }
        output.push(((value & 0x7f) | 0x80) as u8);
        value = ((value as u32) >> 7) as i32;
    }
}

fn read_varint(reader: &mut impl Read) -> std::io::Result<i32> {
    let mut value = 0;
    for position in 0..5 {
        let mut byte = [0u8; 1];
        reader.read_exact(&mut byte)?;
        value |= ((byte[0] & 0x7f) as i32) << (position * 7);
        if byte[0] & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        "VarInt is too large",
    ))
}

#[cfg(test)]
mod tests {
    use super::{RAKNET_MAGIC, parse_bedrock_pong};

    fn pong(motd: &str) -> Vec<u8> {
        let mut packet = vec![0x1c];
        packet.extend_from_slice(&1234u64.to_be_bytes());
        packet.extend_from_slice(&5678u64.to_be_bytes());
        packet.extend_from_slice(&RAKNET_MAGIC);
        packet.extend_from_slice(&(motd.len() as u16).to_be_bytes());
        packet.extend_from_slice(motd.as_bytes());
        packet
    }

    #[test]
    fn parses_bedrock_raknet_pong() {
        let status = parse_bedrock_pong(&pong(
            "MCPE;Dedicated Server;818;1.26.44;3;20;123456;Bedrock level;Survival;1;19132;19133;",
        ))
        .unwrap();
        assert_eq!(status.online, 3);
        assert_eq!(status.max, 20);
        assert_eq!(status.server_name.as_deref(), Some("Dedicated Server"));
        assert_eq!(status.version.as_deref(), Some("1.26.44"));
    }

    #[test]
    fn rejects_truncated_wrong_magic_and_impossible_player_counts() {
        assert!(parse_bedrock_pong(&[0x1c]).is_none());
        let mut wrong_magic = pong("MCPE;Server;818;1.26.44;1;20;");
        wrong_magic[20] ^= 0xff;
        assert!(parse_bedrock_pong(&wrong_magic).is_none());
        assert!(parse_bedrock_pong(&pong("MCPE;Server;818;1.26.44;21;20;")).is_none());
    }
}
