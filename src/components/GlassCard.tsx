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
    width:"100%",
    backgroundColor: COLORS.glass,
    borderRadius: RADIUS.large,
    padding:30,
    borderWidth:1,
    borderColor:COLORS.glassBorder,
    alignItems: "center",
    ...SHADOW,
  }

});

