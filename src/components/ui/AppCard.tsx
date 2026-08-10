import React from "react";
import {
  StyleSheet,
  ViewProps,
} from "react-native";

import GlassSurface from "./GlassSurface";


interface AppCardProps extends ViewProps {
  children: React.ReactNode;
}


export default function AppCard({
  children,
  style,
  ...props
}: AppCardProps) {

  return (

    <GlassSurface
      style={[
        styles.card,
        style,
      ]}
      {...props}
    >

      {children}

    </GlassSurface>

  );

}


const styles = StyleSheet.create({

  card: {

    borderRadius: 24,

    marginVertical: 8,

  },

});