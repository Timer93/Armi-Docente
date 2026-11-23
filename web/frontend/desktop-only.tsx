import React from 'react';
import {DrivePanel} from './DrivePanel';
export function SyncLifecycleManager() { return null; }
export function BackgroundSyncIndicator() { return null; }
export function RemoteAccessIndicator() { return null; }
export function AppUpdaterOverlay() { return null; }
export function GeneralNotesOverlay() { return null; }
export function GeneralNotesFloatingButton() { return null; }
export function CloudSyncPanel() { return <DrivePanel compact/>; }
export function observePortableStorage() { return () => {}; }
