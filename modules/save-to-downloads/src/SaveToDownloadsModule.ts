import { NativeModule, requireNativeModule } from 'expo';

export type SaveToDownloadsResult = {
  displayName: string;
  uri: string;
};

declare class SaveToDownloadsModule extends NativeModule<{}> {
  saveToDownloads(sourceUri: string, fileName: string, mimeType: string | null): Promise<SaveToDownloadsResult>;
}

export default requireNativeModule<SaveToDownloadsModule>('SaveToDownloads');