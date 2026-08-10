import React from "react";
import {
  Text,
  TextProps,
  StyleSheet,
} from "react-native";

import { TYPOGRAPHY, COLORS } from "../../theme";


interface AppTextProps extends TextProps {

  variant?:
    | "title"
    | "heading"
    | "body"
    | "caption";

}


export default function AppText({

  variant = "body",

  style,

  children,

  ...props

}: AppTextProps) {


  return (

    <Text

      style={[
        styles.base,
        TYPOGRAPHY[variant],
        style,
      ]}

      {...props}

    >

      {children}

    </Text>

  );

}


const styles = StyleSheet.create({

  base: {

    color: COLORS.text,

  },

});