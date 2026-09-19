// Base type definitions for platform-specific MapExports.
// The bundler resolves MapExports.native.tsx (iOS/Android) or MapExports.web.tsx (web)
// at build time. This file exists so TypeScript can resolve the module for type-checking.

import React from "react";

type AnyProps = Record<string, any>;

// The MapView component type — used as useRef<MapView>(null)
export type MapViewType = React.ComponentType<AnyProps> & {
  animateToRegion: (region: AnyProps, duration?: number) => void;
};

export declare const MapView: MapViewType;
export declare const PROVIDER_DEFAULT: string | null;
export declare function Marker(props: AnyProps): React.ReactElement | null;
export declare const MarkerAnimated: React.ComponentType<AnyProps>;
export declare class AnimatedRegion {
  constructor(value?: Partial<{ latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }>);
  setValue(value: { latitude: number; longitude: number; latitudeDelta?: number; longitudeDelta?: number }): void;
  timing(config: Record<string, unknown> & { latitude: number; longitude: number }): { start: (cb?: (result: { finished: boolean }) => void) => void; stop: () => void };
  stopAnimation(cb?: (region: unknown) => void): void;
}
export declare function Callout(props: AnyProps): React.ReactElement | null;
export declare function Polyline(props: AnyProps): React.ReactElement | null;
