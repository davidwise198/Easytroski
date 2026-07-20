import {
  Text,
  StyleSheet,
} from "react-native";

import { router } from "expo-router";

import ScreenBackground from "../src/components/ScreenBackground";
import GlassCard from "../src/components/GlassCard";
import GlassButton from "../src/components/GlassButton";

import {
  COLORS,
  SIZES,
} from "../src/constants/theme";


export default function WelcomeScreen() {

  return (

    <ScreenBackground>

      <GlassCard>

        <Text style={styles.logo}>
          EasyTroski
        </Text>


        <Text style={styles.title}>
          Smart Trotro Booking
        </Text>


        <Text style={styles.description}>
          Find available vehicles, reserve seats,
          and travel smarter with real-time
          transport information.
        </Text>


        <GlassButton
          title="Get Started"
          onPress={() =>
            router.push("/auth/register")
          }
        />


        <Text
          style={styles.login}
          onPress={() =>
            router.push("/auth/login")
          }
        >
          Already have an account? Login
        </Text>


      </GlassCard>

    </ScreenBackground>

  );

}



const styles = StyleSheet.create({

  logo:{
  fontSize:42,
  fontWeight:"bold",
  color:COLORS.primary,
  textAlign:"center",
  marginBottom:20,
},

  title:{
    fontSize:22,
    fontWeight:"bold",
    textAlign:"center",
    marginBottom:SIZES.small,
  },


  description:{
  textAlign:"center",
  color:COLORS.textLight,
  marginBottom:30,
  lineHeight:24,
},

  login:{
    marginTop:SIZES.medium,
    textAlign:"center",
    color:COLORS.primary,
    fontWeight:"600",
  }

});