import {
  View,
  StyleSheet,
} from "react-native";

import {
  COLORS,
  RADIUS,
  SHADOW,
} from "../constants/theme";


interface Props {
  children: React.ReactNode;
}


export default function GlassCard({children}: Props) {

  return (
    <View style={styles.card}>
      {children}
    </View>
  );

}


const styles = StyleSheet.create({

  card:{
    backgroundColor: COLORS.glass,

    borderRadius: RADIUS.large,

    padding:20,

    borderWidth:1,

    borderColor:COLORS.glassBorder,

    ...SHADOW,

  }

});