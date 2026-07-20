// User roles in the system
export type UserRole = "passenger" | "driver" | "admin";


// Booking status
export type BookingStatus =
  | "pending"
  | "confirmed"
  | "picked_up"
  | "completed"
  | "cancelled";


// Driver trip status
export type TripStatus =
  | "offline"
  | "online"
  | "in_progress";


export type TripDirection =
  | "going"
  | "returning";

// Basic location structure
export interface Location {
  latitude: number;
  longitude: number;
  address?: string;
}


// Main user account
export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  photoURL?: string;
  role: UserRole;
  createdAt: Date;
}


// Vehicle information
export interface Vehicle {
  id: string;
  driverId: string;
  numberPlate: string;
  color: string;
  capacity: number;
  active: boolean;
}


// Driver profile
export interface Driver {
  id: string;
  userId: string;
  vehicleId: string;

  routeId?: string;

  online: boolean;
  status: TripStatus;

  availableSeats: number;

  currentLocation?: Location;

  rating?: number;
}


// Passenger profile
export interface Passenger {
  id: string;
  userId: string;
}


// Route information
export interface Route {
  id: string;

  origin: string;
  destination: string;

  stops: string[];

  active: boolean;
}


// Passenger booking
export interface Booking {
  id: string;

  passengerId: string;
  driverId: string;

  routeId: string;

  pickupLocation: Location;
  dropOffLocation: Location;

  seats: number;

  status: BookingStatus;

  createdAt: Date;
  cancelledAt?: Date;
  cancelledBy?: string;
}


// Driver trip session
export interface Trip {
  id: string;

  driverId: string;

  routeId: string;

  status: TripStatus;

  direction: TripDirection;

  startTime?: Date;
  endTime?: Date;
}