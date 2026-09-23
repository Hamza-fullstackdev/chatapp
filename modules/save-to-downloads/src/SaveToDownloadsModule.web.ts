import { registerWebModule, NativeModule } from 'expo';

// SaveToDownloadsModule is not available on the web platform.
class SaveToDownloadsModule extends NativeModule<{}> {}

export default registerWebModule(SaveToDownloadsModule, 'SaveToDownloadsModule');
