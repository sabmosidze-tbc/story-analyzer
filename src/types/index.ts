export interface AnalysisBlock {
  title: string;
  content: string;
}

export interface Analysis {
  explanation: AnalysisBlock;
  deskCheck: AnalysisBlock;
  testSuggestions: AnalysisBlock;
}

export interface StoryEntry {
  id: string;
  title: string;
  storyText: string;
  analysis: Analysis;
  createdAt: string;
  updatedAt: string;
}
