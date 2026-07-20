import {
  Pressable,
  Text,
  StyleSheet,
} from "react-native";

import {
  COLORS,
  RADIUS,
} from "../constants/theme";


interface Props {
  title: string;
  onPress: () => void;
}


export default function GlassButton({
  title,
  onPress,
}: Props) {

  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
    >
      <Text style={styles.text}>
        {title}
      </Text>
    </Pressable>
  );

}


const styles = StyleSheet.create({

  button: {

    backgroundColor: COLORS.primary,

    paddingVertical: 16,

    borderRadius: RADIUS.medium,

    alignItems: "center",

    width: "100%",

  },


  text: {

    color: COLORS.secondary,

    fontSize: 16,

    fontWeight: "bold",

  },

});