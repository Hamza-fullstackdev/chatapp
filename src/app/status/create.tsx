import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWaTheme } from "@/context/theme-context";
import { statusesApi } from "@/lib/api";
import { uploadAsset } from "@/lib/media";
import { getDb } from "@/db/database";
import { upsertStatus } from "@/db/repositories";
import { getStatusAudience } from "@/lib/status-audience";
import { notifyLocalDb } from "@/lib/local-db-events";
import type { StatusAudience } from "@/types/api";

const BG_COLORS = [
  "#25D366",
  "#1E6FD9",
  "#E5423D",
  "#F3A132",
  "#5F59C6",
  "#0E8A3A",
  "#111B21",
  "#7B8794",
];
const FONT_OPTIONS = ["Sans-serif", "Serif", "Monospace"];

export default function CreateStatusScreen() {
  const { colors, dark } = useWaTheme();
  const params = useLocalSearchParams<{ mode?: "text" | "media" }>();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<"text" | "media">(
    params.mode === "media" ? "media" : "text",
  );
  const [text, setText] = useState("");
  const [bg, setBg] = useState(
    BG_COLORS[Math.floor(Math.random() * BG_COLORS.length)]!,
  );
  const [font, setFont] = useState(FONT_OPTIONS[0]!);

  const [picked, setPicked] = useState<{
    uri: string;
    contentType: string;
    size?: number;
    width?: number;
    height?: number;
    durationMs?: number;
  } | null>(null);

  const [audience, setAudience] = useState<StatusAudience>("my_contacts");
  const [excludeUserIds, setExcludeUserIds] = useState<string[]>([]);
  const [includeUserIds, setIncludeUserIds] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [picking, setPicking] = useState(false);

  const pickingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void getStatusAudience().then((a) => {
        if (!active || !a) return;
        setAudience(a.audience);
        setExcludeUserIds(a.excludeUserIds);
        setIncludeUserIds(a.includeUserIds);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const pickMedia = async () => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Permission required",
          "Allow photo library access to add media statuses.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsEditing: true,
        quality: 0.85,
      });
      if (result.canceled || result.assets.length === 0) {
        if (mode === "media" && !picked) {
          router.back();
        }
        return;
      }
      const asset = result.assets[0]!;
      setPicked({
        uri: asset.uri,
        contentType:
          asset.mimeType ??
          (asset.type === "video" ? "video/mp4" : "image/jpeg"),
        size: asset.fileSize ?? undefined,
        width: asset.width,
        height: asset.height,
        durationMs: asset.duration
          ? Math.round(asset.duration * 1000)
          : undefined,
      });
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  };

  useEffect(() => {
    if (params.mode === "media" && !picked && !pickingRef.current) {
      void pickMedia();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.mode]);

  const cycleBg = () => {
    const idx = BG_COLORS.indexOf(bg);
    setBg(BG_COLORS[(idx + 1) % BG_COLORS.length]!);
  };

  const cycleFont = () => {
    const idx = FONT_OPTIONS.indexOf(font);
    setFont(FONT_OPTIONS[(idx + 1) % FONT_OPTIONS.length]!);
  };

  const post = async () => {
    if (posting) return;
    const trimmed = text.trim();
    if (mode === "text" && !trimmed) {
      Alert.alert("Add text", "Type something to share as a status.");
      return;
    }
    if (mode === "media" && !picked) {
      Alert.alert(
        "Add media",
        "Choose an image or video to share as a status.",
      );
      return;
    }
    setPosting(true);
    try {
      let type: "text" | "image" | "video" = "text";
      let mediaPath: string | null = null;
      let mediaThumbnailPath: string | null = null;
      let mimeType: string | null = null;

      if (mode === "media" && picked) {
        const isVideo = picked.contentType.startsWith("video/");
        type = isVideo ? "video" : "image";
        const uploaded = await uploadAsset("chat-media", picked, {
          width: picked.width,
          height: picked.height,
          durationMs: picked.durationMs,
        });
        mediaPath = uploaded.attachment.storagePath;
        mediaThumbnailPath = isVideo ? null : uploaded.attachment.storagePath;
        mimeType = uploaded.attachment.mimeType;
      }

      const { status } = await statusesApi.create({
        type,
        text: trimmed || null,
        font: mode === "text" ? font : null,
        bgColor: mode === "text" ? bg : null,
        mediaPath,
        mediaThumbnailPath,
        mimeType,
        audience,
        excludeUserIds:
          audience === "my_contacts_except" ? excludeUserIds : undefined,
        includeUserIds:
          audience === "only_share_with" ? includeUserIds : undefined,
      });

      const db = await getDb();
      await upsertStatus(db, status);
      notifyLocalDb();
      router.back();
    } catch (e) {
      Alert.alert(
        "Could not post status",
        e instanceof Error ? e.message : "Try again",
      );
    } finally {
      setPosting(false);
    }
  };

  const currentFontStyle = useMemo(() => {
    switch (font) {
      case "Serif":
        return {
          fontFamily: Platform.select({ ios: "Georgia", android: "serif" }),
        };
      case "Monospace":
        return {
          fontFamily: Platform.select({ ios: "Courier", android: "monospace" }),
        };
      default:
        return { fontWeight: "500" as const };
    }
  }, [font]);

  const audienceLabel = useMemo(() => {
    switch (audience) {
      case "my_contacts":
        return "My contacts";
      case "my_contacts_except":
        return "My contacts except…";
      case "only_share_with":
        return "Only share with…";
    }
  }, [audience]);

  if (mode === "media" && picking && !picked) {
    return (
      <View
        style={[
          styles.safe,
          { backgroundColor: "#000000", justifyContent: "center" },
        ]}
      >
        <StatusBar style='light' />
        <ActivityIndicator size='large' color={colors.brand} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[
        styles.safe,
        { backgroundColor: mode === "text" ? bg : "#000000" },
      ]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar style='light' />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.headerBtn}
        >
          <Ionicons name='close' size={28} color='#FFFFFF' />
        </Pressable>
        <View style={styles.headerRight}>
          {mode === "text" && (
            <>
              <Pressable onPress={cycleFont} style={styles.headerBtn}>
                <Ionicons name='text' size={24} color='#FFFFFF' />
              </Pressable>
              <Pressable onPress={cycleBg} style={styles.headerBtn}>
                <Ionicons name='color-palette' size={24} color='#FFFFFF' />
              </Pressable>
            </>
          )}
        </View>
      </View>

      <View style={styles.content}>
        {mode === "text" ? (
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder='Type a status'
            placeholderTextColor='rgba(255,255,255,0.5)'
            style={[styles.textInput, currentFontStyle, { color: "#FFFFFF" }]}
            multiline
            autoFocus
          />
        ) : picked ? (
          <View style={styles.mediaContainer}>
            {picked.contentType.startsWith("video/") ? (
              <View style={styles.videoPlaceholder}>
                <Ionicons
                  name='videocam'
                  size={64}
                  color='rgba(255,255,255,0.5)'
                />
                <Text style={{ color: "#FFFFFF", marginTop: 12, fontSize: 16 }}>
                  Video status
                </Text>
              </View>
            ) : (
              <Image
                source={{ uri: picked.uri }}
                style={styles.mediaPreview}
                contentFit='contain'
              />
            )}
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder='Add a caption…'
              placeholderTextColor='rgba(255,255,255,0.7)'
              style={styles.captionInput}
            />
          </View>
        ) : (
          <Pressable style={styles.emptyMedia} onPress={() => void pickMedia()}>
            <Ionicons
              name='image-outline'
              size={64}
              color='rgba(255,255,255,0.5)'
            />
            <Text style={{ color: "#FFFFFF", marginTop: 12 }}>
              Tap to add media
            </Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/status/audience",
              params: {
                audience,
                exclude: JSON.stringify(excludeUserIds),
                include: JSON.stringify(includeUserIds),
              },
            })
          }
          style={styles.audienceChip}
        >
          <Ionicons name='lock-closed' size={14} color='#FFFFFF' />
          <Text style={styles.audienceText}>Status ({audienceLabel})</Text>
        </Pressable>

        <Pressable
          onPress={() => void post()}
          disabled={posting}
          style={[styles.sendBtn, { backgroundColor: colors.brand }]}
        >
          {posting ? (
            <ActivityIndicator size='small' color='#FFFFFF' />
          ) : (
            <Ionicons name='send' size={24} color='#FFFFFF' />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    zIndex: 10,
  },
  headerRight: { flexDirection: "row", gap: 8 },
  headerBtn: { padding: 8 },
  content: { flex: 1, justifyContent: "center" },
  textInput: {
    fontSize: 32,
    textAlign: "center",
    paddingHorizontal: 24,
    maxHeight: "60%",
  },
  mediaContainer: { flex: 1 },
  mediaPreview: { flex: 1, width: "100%" },
  videoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyMedia: { flex: 1, alignItems: "center", justifyContent: "center" },
  captionInput: {
    backgroundColor: "rgba(0,0,0,0.4)",
    color: "#FFFFFF",
    paddingHorizontal: 20,
    paddingVertical: 14,
    fontSize: 16,
    borderRadius: 24,
    margin: 12,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  audienceChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  audienceText: { color: "#FFFFFF", fontSize: 13, fontWeight: "500" },
  sendBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
});
