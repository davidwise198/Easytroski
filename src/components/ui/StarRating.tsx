import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { COLORS, SPACING } from "../../theme";

type StarRatingProps = {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  readonly?: boolean;
};

export default function StarRating({
  value,
  onChange,
  size = 32,
  readonly = false,
}: StarRatingProps) {
  const [hovered, setHovered] = useState(0);

  return (
    <View style={styles.container}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = readonly ? star <= value : star <= (hovered || value);
        return (
          <Pressable
            key={star}
            style={styles.star}
            onPress={() => !readonly && onChange?.(star)}
            onPressIn={() => !readonly && setHovered(star)}
            onPressOut={() => !readonly && setHovered(0)}
            disabled={readonly}
          >
            <MaterialCommunityIcons
              name={filled ? "star" : "star-outline"}
              size={size}
              color={filled ? COLORS.accent : COLORS.textSecondary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: SPACING.xs,
  },
  star: {
    padding: 2,
  },
});
