export type IngestedDocument = {
  url: string;
  title: string;
  content: string;
  source: string;
};

export interface SourceAdapter {
  name: string;
  fetch(query: string): Promise<IngestedDocument[]>;
}
