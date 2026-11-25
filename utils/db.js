import admin from "../config/firebase.js";

/** Firestore örneği ve sık kullanılan koleksiyon/alan yardımcıları (controller'larda tekrar tanımlanmasın). */
export const db = () => admin.firestore();
export const listingsCol = () => db().collection("Listings");
export const usersCol = () => db().collection("Users");
export const { FieldValue } = admin.firestore;
