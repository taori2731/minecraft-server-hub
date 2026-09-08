use crate::models::ServerProfile;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameKind {
    Minecraft,
    Palworld,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameAdapter {
    MinecraftJava,
    MinecraftBedrock,
    Palworld,
}

pub trait ServerAdapter {
    fn game_kind(self) -> GameKind;
    fn runtime_kind(self) -> &'static str;
    fn network_transport(self) -> &'static str;
    fn accepts_console_commands(self) -> bool;
    fn uses_java(self) -> bool;
}

impl ServerAdapter for GameAdapter {
    fn game_kind(self) -> GameKind {
        match self {
            Self::MinecraftJava | Self::MinecraftBedrock => GameKind::Minecraft,
            Self::Palworld => GameKind::Palworld,
        }
    }

    fn runtime_kind(self) -> &'static str {
        match self {
            Self::MinecraftJava => "jvm",
            Self::MinecraftBedrock | Self::Palworld => "native",
        }
    }

    fn network_transport(self) -> &'static str {
        match self {
            Self::MinecraftJava => "tcp",
            Self::MinecraftBedrock | Self::Palworld => "udp",
        }
    }

    fn accepts_console_commands(self) -> bool {
        !matches!(self, Self::Palworld)
    }

    fn uses_java(self) -> bool {
        matches!(self, Self::MinecraftJava)
    }
}

impl GameAdapter {
    pub fn from_parts(game_kind: &str, server_type: &str) -> Self {
        if game_kind.eq_ignore_ascii_case("palworld") || server_type == "palworld" {
            Self::Palworld
        } else if server_type == "bedrock" {
            Self::MinecraftBedrock
        } else {
            Self::MinecraftJava
        }
    }

    pub fn for_profile(profile: &ServerProfile) -> Self {
        Self::from_parts(&profile.game_kind, &profile.server_type)
    }

    pub fn is_palworld(self) -> bool {
        matches!(self, Self::Palworld)
    }

    pub fn is_minecraft_bedrock(self) -> bool {
        matches!(self, Self::MinecraftBedrock)
    }
}

#[cfg(test)]
mod tests {
    use super::{GameAdapter, GameKind, ServerAdapter};

    #[test]
    fn selects_adapters_without_treating_palworld_as_java() {
        let java = GameAdapter::from_parts("minecraft", "paper");
        let bedrock = GameAdapter::from_parts("minecraft", "bedrock");
        let palworld = GameAdapter::from_parts("palworld", "palworld");

        assert_eq!(java.game_kind(), GameKind::Minecraft);
        assert_eq!(java.runtime_kind(), "jvm");
        assert_eq!(java.network_transport(), "tcp");
        assert!(java.uses_java());

        assert_eq!(bedrock.runtime_kind(), "native");
        assert_eq!(bedrock.network_transport(), "udp");
        assert!(bedrock.accepts_console_commands());

        assert_eq!(palworld.game_kind(), GameKind::Palworld);
        assert_eq!(palworld.runtime_kind(), "native");
        assert_eq!(palworld.network_transport(), "udp");
        assert!(!palworld.accepts_console_commands());
        assert!(!palworld.uses_java());
    }
}
