import { 
  View, 
  StyleSheet 
} from "react-native";

import { COLORS } from "../constants/theme";


interface Props {
  children: React.ReactNode;
}


export default function ScreenBackground({ children }: Props) {
  return (
    <View style={styles.container}>
      {children}
    </View>
  );
}


const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },

});